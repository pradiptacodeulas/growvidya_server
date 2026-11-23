const { pool } = require('../config/db.config');

let xlsxLib = null;
function getXlsx() {
  if (xlsxLib) return xlsxLib;
  try {
    xlsxLib = require('xlsx');
  } catch {
    xlsxLib = require('../../growvidya_csv_server/node_modules/xlsx');
  }
  return xlsxLib;
}

class AcademicModel {
  static _assignmentSchemaPromise = null;

  static async ensureAssignmentSchema() {
    if (AcademicModel._assignmentSchemaPromise) {
      return AcademicModel._assignmentSchemaPromise;
    }
    AcademicModel._assignmentSchemaPromise = (async () => {
      try {
        const addMissingColumns = async (tableName, columnDefinitions) => {
          const [cols] = await pool.query(`SHOW COLUMNS FROM ${tableName}`);
          const existing = new Set((cols || []).map((c) => c.Field));
          const toAdd = [];
          for (const [colName, colDef] of columnDefinitions) {
            if (!existing.has(colName)) {
              toAdd.push(`ADD COLUMN ${colName} ${colDef}`);
            }
          }
          if (toAdd.length > 0) {
            await pool.query(`ALTER TABLE ${tableName} ${toAdd.join(', ')}`);
          }
        };

        await addMissingColumns('assignments', [
          ['start_time', 'VARCHAR(20) DEFAULT NULL'],
          ['end_time', 'VARCHAR(20) DEFAULT NULL'],
          ['duration_minutes', 'INT(11) DEFAULT NULL'],
          ['total_marks', 'DECIMAL(10,2) DEFAULT NULL'],
          ['passing_marks', 'DECIMAL(10,2) DEFAULT NULL'],
          ['max_attempts', 'INT(11) NOT NULL DEFAULT 1'],
          ['instructions', 'TEXT DEFAULT NULL'],
        ]);

        await pool.query(`ALTER TABLE assignment_questions MODIFY COLUMN question TEXT NULL`).catch(() => {});
        await addMissingColumns('assignment_questions', [
          ['question_type', "VARCHAR(50) NOT NULL DEFAULT 'MCQ'"],
          ['marks', 'DECIMAL(8,2) NOT NULL DEFAULT 1.00'],
          ['instructions', 'TEXT DEFAULT NULL'],
          ['correct_answer_text', 'TEXT DEFAULT NULL'],
        ]);

        await pool.query(`ALTER TABLE assignment_answers MODIFY COLUMN answer TEXT NULL`).catch(() => {});

        await addMissingColumns('student_assignment_attempts', [
          ['attempt_number', 'INT(11) NOT NULL DEFAULT 1'],
          ['started_at', 'DATETIME DEFAULT NULL'],
          ['submitted_at', 'DATETIME DEFAULT NULL'],
          ['obtained_marks', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00'],
          ['total_marks', 'DECIMAL(10,2) NOT NULL DEFAULT 0.00'],
          ['is_passed', 'TINYINT(1) DEFAULT NULL'],
          ['is_auto_submitted', 'TINYINT(1) NOT NULL DEFAULT 0'],
        ]);

        await addMissingColumns('student_assignment_submissions', [
          ['answer_text', 'TEXT DEFAULT NULL'],
          ['marks_awarded', 'DECIMAL(8,2) NOT NULL DEFAULT 0.00'],
        ]);
      } catch (err) {
        console.error('[AcademicModel.ensureAssignmentSchema] Error:', err.message);
      }
    })();
    return AcademicModel._assignmentSchemaPromise;
  }

  static normalizeQuestionType(rawType) {
    if (!rawType && rawType !== 0) return null;
    const s = String(rawType)
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
    if (
      [
        'mcq',
        'multiple_choice',
        'multiple_choice_question',
        'multiple_choice_questions',
        'multiplechoice',
        'single_choice',
        'objective',
      ].includes(s)
    ) {
      return 'MCQ';
    }
    if (['true_false', 'true_or_false', 'tf', 't_f', 'boolean'].includes(s)) {
      return 'TRUE_FALSE';
    }
    if (['short_answer', 'short', 'short_answers', 'short_question', 'sa'].includes(s)) {
      return 'SHORT_ANSWER';
    }
    if (['long_answer', 'long', 'long_answers', 'long_question', 'descriptive', 'essay', 'la'].includes(s)) {
      return 'LONG_ANSWER';
    }
    return null;
  }

  static getQuestionTypeLabel(qType) {
    const norm = AcademicModel.normalizeQuestionType(qType) || 'MCQ';
    if (norm === 'TRUE_FALSE') return 'True / False';
    if (norm === 'SHORT_ANSWER') return 'Short Answer';
    if (norm === 'LONG_ANSWER') return 'Long Answer';
    return 'Multiple Choice (MCQ)';
  }

  static combineDateAndTime(dateVal, timeVal, isEnd = false) {
    if (!dateVal) return null;
    const rawDateStr =
      dateVal instanceof Date
        ? `${dateVal.getFullYear()}-${String(dateVal.getMonth() + 1).padStart(2, '0')}-${String(dateVal.getDate()).padStart(2, '0')}`
        : String(dateVal).trim();
    if (!rawDateStr) return null;

    const datePartMatch = rawDateStr.match(/^(\d{4}-\d{2}-\d{2})/);
    const datePart = datePartMatch ? datePartMatch[1] : null;
    const embeddedTimeMatch = rawDateStr.match(/[T\s](\d{1,2}:\d{2}(?::\d{2})?)/);

    let cleanTime = timeVal ? String(timeVal).trim() : '';
    if (!cleanTime && embeddedTimeMatch) {
      cleanTime = embeddedTimeMatch[1];
    }

    if (datePart) {
      if (cleanTime) {
        const parts = cleanTime.split(':');
        const hh = String(Number(parts[0]) || 0).padStart(2, '0');
        const mm = String(Number(parts[1]) || 0).padStart(2, '0');
        const ss = parts[2] !== undefined ? String(Number(parts[2]) || 0).padStart(2, '0') : isEnd ? '59' : '00';
        const dt = new Date(`${datePart}T${hh}:${mm}:${ss}${isEnd ? '.999' : '.000'}`);
        return isNaN(dt.getTime()) ? null : dt;
      }
      const dt = new Date(`${datePart}T${isEnd ? '23:59:59.999' : '00:00:00.000'}`);
      return isNaN(dt.getTime()) ? null : dt;
    }

    const parsed = new Date(rawDateStr);
    return isNaN(parsed.getTime()) ? null : parsed;
  }

  static getAssignmentScheduleState(assignment, now = new Date()) {
    if (!assignment) {
      return {
        startDateTime: null,
        endDateTime: null,
        isNotStarted: false,
        isExpired: false,
        isAvailable: true,
      };
    }
    const startDt = AcademicModel.combineDateAndTime(assignment.assigned_date, assignment.start_time, false);
    const endDt = AcademicModel.combineDateAndTime(assignment.due_date, assignment.end_time, true);
    const nowMs = now instanceof Date ? now.getTime() : Date.now();

    const isNotStarted = startDt ? nowMs < startDt.getTime() : false;
    const isExpired = endDt ? nowMs > endDt.getTime() : false;
    const isAvailable = !isNotStarted && !isExpired;

    return {
      startDateTime: startDt ? startDt.toISOString() : null,
      endDateTime: endDt ? endDt.toISOString() : null,
      isNotStarted,
      isExpired,
      isAvailable,
    };
  }

  static generateAssignmentQuestionsTemplateBuffer() {
    const xlsx = getXlsx();
    const headers = [
      'question_type',
      'question',
      'option_a',
      'option_b',
      'option_c',
      'option_d',
      'correct_answer',
      'marks',
      'instructions',
    ];
    const worksheet = xlsx.utils.aoa_to_sheet([headers]);
    worksheet['!cols'] = headers.map((h) => ({
      wch: h === 'question' || h === 'instructions' ? 38 : 20,
    }));
    const workbook = xlsx.utils.book_new();
    xlsx.utils.book_append_sheet(workbook, worksheet, 'Assignment_Questions');
    return xlsx.write(workbook, { type: 'buffer', bookType: 'xlsx' });
  }

  static parseAndValidateQuestionsExcel(buffer, existingQuestions = []) {
    if (!buffer || !Buffer.isBuffer(buffer) || buffer.length === 0) {
      const err = new Error('Please upload a valid Excel (.xlsx, .xls) or CSV file.');
      err.statusCode = 400;
      throw err;
    }

    const xlsx = getXlsx();
    let workbook;
    try {
      workbook = xlsx.read(buffer, { type: 'buffer', cellDates: false, raw: true });
    } catch (e) {
      const err = new Error('Invalid or corrupted Excel file. Please use the provided Excel template.');
      err.statusCode = 400;
      throw err;
    }

    const firstSheetName = workbook?.SheetNames?.[0];
    if (!firstSheetName) {
      const err = new Error('The uploaded Excel file contains no worksheets.');
      err.statusCode = 400;
      throw err;
    }

    const worksheet = workbook.Sheets[firstSheetName];
    const rawMatrix = xlsx.utils.sheet_to_json(worksheet, {
      header: 1,
      defval: '',
      blankrows: false,
      raw: true,
    });

    if (!Array.isArray(rawMatrix) || rawMatrix.length === 0) {
      const err = new Error('The uploaded Excel file is empty.');
      err.statusCode = 400;
      throw err;
    }

    const normHeader = (h) =>
      String(h || '')
        .replace(/^\uFEFF/, '')
        .trim()
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '_')
        .replace(/^_+|_+$/g, '');

    const rawHeaders = (rawMatrix[0] || []).map(normHeader);
    const hasQuestionCol = rawHeaders.some((h) =>
      ['question', 'question_statement', 'question_text', 'statement', 'title'].includes(h)
    );
    const hasTypeCol = rawHeaders.some((h) => ['question_type', 'type', 'q_type'].includes(h));
    const hasMarksCol = rawHeaders.some((h) => ['marks', 'mark', 'points', 'score'].includes(h));

    if (!hasQuestionCol || !hasTypeCol || !hasMarksCol) {
      const err = new Error(
        'Invalid Excel template format. Required columns: question_type, question, option_a, option_b, option_c, option_d, correct_answer, marks, instructions.'
      );
      err.statusCode = 400;
      throw err;
    }

    if (rawMatrix.length < 2) {
      const err = new Error('The uploaded Excel file has column headers but contains no question rows.');
      err.statusCode = 400;
      throw err;
    }

    const existingNormalizedMap = new Map();
    if (Array.isArray(existingQuestions)) {
      existingQuestions.forEach((eq, idx) => {
        const text = String(eq?.question || eq?.title || '')
          .trim()
          .toLowerCase()
          .replace(/\s+/g, ' ');
        if (text) {
          existingNormalizedMap.set(text, idx + 1);
        }
      });
    }

    const fileQuestionsNormalizedMap = new Map();
    const parsedRows = [];
    const validQuestions = [];
    const allErrors = [];
    let totalValidMarks = 0;

    const cellToStr = (val) => (val === undefined || val === null ? '' : String(val).trim());

    for (let i = 1; i < rawMatrix.length; i++) {
      const rowCells = rawMatrix[i];
      if (!Array.isArray(rowCells) || rowCells.every((c) => cellToStr(c) === '')) {
        continue;
      }

      const rowNumber = i + 1;
      const rawObj = {};
      rawHeaders.forEach((h, colIdx) => {
        if (h) rawObj[h] = cellToStr(rowCells[colIdx]);
      });

      if (Object.values(rawObj).every((v) => v === '')) {
        continue;
      }

      const rowErrors = [];
      const rawTypeStr = rawObj.question_type ?? rawObj.type ?? rawObj.q_type ?? '';
      const normalizedType = AcademicModel.normalizeQuestionType(rawTypeStr);

      if (!rawTypeStr) {
        rowErrors.push('Question type is required (MCQ, True / False, Short Answer, or Long Answer).');
      } else if (!normalizedType) {
        rowErrors.push(
          `Invalid question type "${rawTypeStr}". Supported types: MCQ, True / False, Short Answer, Long Answer.`
        );
      }

      const questionText =
        rawObj.question ||
        rawObj.question_statement ||
        rawObj.question_text ||
        rawObj.statement ||
        rawObj.title ||
        '';

      if (!questionText) {
        rowErrors.push('Question statement is required.');
      } else {
        const normQ = questionText.toLowerCase().replace(/\s+/g, ' ');
        if (fileQuestionsNormalizedMap.has(normQ)) {
          rowErrors.push(`Duplicate question in Excel file (already appears on row #${fileQuestionsNormalizedMap.get(normQ)}).`);
        } else if (existingNormalizedMap.has(normQ)) {
          rowErrors.push(
            `Duplicate question (already exists in the assignment at Question #${existingNormalizedMap.get(normQ)}).`
          );
        } else {
          fileQuestionsNormalizedMap.set(normQ, rowNumber);
        }
      }

      const rawMarksStr = rawObj.marks ?? rawObj.mark ?? rawObj.points ?? rawObj.score ?? '';
      const marksNum = Number(rawMarksStr);
      if (rawMarksStr === '' || isNaN(marksNum) || marksNum <= 0) {
        rowErrors.push('Marks is required and must be a positive number greater than 0.');
      }

      const instructionsText = rawObj.instructions || rawObj.instruction || rawObj.notes || '';
      const optA = rawObj.option_a ?? rawObj.optiona ?? rawObj.a ?? '';
      const optB = rawObj.option_b ?? rawObj.optionb ?? rawObj.b ?? '';
      const optC = rawObj.option_c ?? rawObj.optionc ?? rawObj.c ?? '';
      const optD = rawObj.option_d ?? rawObj.optiond ?? rawObj.d ?? '';
      const rawCorrect = rawObj.correct_answer ?? rawObj.correct ?? rawObj.answer ?? '';

      let options = [];
      let correctAnswerIndex = 0;
      let correctAnswerLabel = '';
      let correctAnswerText = '';

      if (normalizedType === 'MCQ') {
        const missingOpts = [];
        if (!optA) missingOpts.push('Option A');
        if (!optB) missingOpts.push('Option B');
        if (!optC) missingOpts.push('Option C');
        if (!optD) missingOpts.push('Option D');
        if (missingOpts.length > 0) {
          rowErrors.push(`MCQ requires all 4 options (${missingOpts.join(', ')} missing).`);
        }

        options = [{ text: optA }, { text: optB }, { text: optC }, { text: optD }];

        const nonEmptyOptTexts = [optA, optB, optC, optD]
          .filter(Boolean)
          .map((o) => o.toLowerCase().replace(/\s+/g, ' '));
        if (new Set(nonEmptyOptTexts).size !== nonEmptyOptTexts.length) {
          rowErrors.push('MCQ options A, B, C, and D must be distinct.');
        }

        if (!rawCorrect) {
          rowErrors.push('Correct answer is required for MCQ (specify A, B, C, or D).');
        } else {
          const cleanCorr = rawCorrect.trim();
          const upperCorr = cleanCorr.toUpperCase().replace(/^OPTION\s+/i, '').trim();
          const letterMap = { A: 0, B: 1, C: 2, D: 3, '1': 0, '2': 1, '3': 2, '4': 3 };
          if (Object.prototype.hasOwnProperty.call(letterMap, upperCorr)) {
            correctAnswerIndex = letterMap[upperCorr];
            correctAnswerLabel = `Option ${String.fromCharCode(65 + correctAnswerIndex)} (${options[correctAnswerIndex]?.text || ''})`;
            correctAnswerText = options[correctAnswerIndex]?.text || '';
          } else {
            const matchIdx = options.findIndex(
              (o) => o.text && o.text.trim().toLowerCase() === cleanCorr.toLowerCase()
            );
            if (matchIdx !== -1) {
              correctAnswerIndex = matchIdx;
              correctAnswerLabel = `Option ${String.fromCharCode(65 + matchIdx)} (${options[matchIdx].text})`;
              correctAnswerText = options[matchIdx].text;
            } else {
              rowErrors.push(
                `Invalid correct_answer "${rawCorrect}" for MCQ. Must be A, B, C, D or match one of the options.`
              );
            }
          }
        }
      } else if (normalizedType === 'TRUE_FALSE') {
        const tfA = optA || 'True';
        const tfB = optB || 'False';
        options = [{ text: tfA }, { text: tfB }];

        if (!rawCorrect) {
          rowErrors.push('Correct answer is required for True / False question (specify True or False).');
        } else {
          const upperCorr = rawCorrect.trim().toUpperCase().replace(/^OPTION\s+/i, '').trim();
          if (['TRUE', 'T', 'A', '1', 'YES'].includes(upperCorr) || rawCorrect.trim().toLowerCase() === tfA.toLowerCase()) {
            correctAnswerIndex = 0;
            correctAnswerLabel = tfA;
            correctAnswerText = tfA;
          } else if (
            ['FALSE', 'F', 'B', '2', 'NO'].includes(upperCorr) ||
            rawCorrect.trim().toLowerCase() === tfB.toLowerCase()
          ) {
            correctAnswerIndex = 1;
            correctAnswerLabel = tfB;
            correctAnswerText = tfB;
          } else {
            rowErrors.push(`Invalid correct_answer "${rawCorrect}" for True / False question. Must be True or False.`);
          }
        }
      } else if (normalizedType === 'SHORT_ANSWER' || normalizedType === 'LONG_ANSWER') {
        options = [];
        correctAnswerIndex = 0;
        correctAnswerText = rawCorrect || '';
        correctAnswerLabel = rawCorrect || 'Descriptive / Open Answer';
      }

      const isValid = rowErrors.length === 0;
      const cleanMarks = !isNaN(marksNum) && marksNum > 0 ? Number(marksNum.toFixed(2)) : 0;

      if (isValid) {
        totalValidMarks = Number((totalValidMarks + cleanMarks).toFixed(2));
        validQuestions.push({
          question: questionText,
          question_type: normalizedType,
          marks: cleanMarks,
          instructions: instructionsText,
          correct_answer: correctAnswerIndex,
          correct_answer_text: correctAnswerText,
          options,
        });
      } else {
        rowErrors.forEach((errMsg) => {
          allErrors.push({
            rowNumber,
            question: questionText || '(Empty Question)',
            error: errMsg,
          });
        });
      }

      parsedRows.push({
        rowNumber,
        isValid,
        errors: rowErrors,
        question_type: normalizedType || rawTypeStr || 'Unknown',
        question_type_label: normalizedType ? AcademicModel.getQuestionTypeLabel(normalizedType) : rawTypeStr || 'Invalid',
        question: questionText,
        option_a: optA,
        option_b: optB,
        option_c: optC,
        option_d: optD,
        options,
        correct_answer: correctAnswerIndex,
        correct_answer_raw: rawCorrect,
        correct_answer_label: correctAnswerLabel || rawCorrect,
        correct_answer_text: correctAnswerText,
        marks: cleanMarks,
        marks_raw: rawMarksStr,
        instructions: instructionsText,
      });
    }

    if (parsedRows.length === 0) {
      const err = new Error('No question rows found in the uploaded Excel file.');
      err.statusCode = 400;
      throw err;
    }

    return {
      totalRows: parsedRows.length,
      validCount: validQuestions.length,
      errorCount: parsedRows.length - validQuestions.length,
      totalValidMarks,
      rows: parsedRows,
      validQuestions,
      errors: allErrors,
    };
  }
  /**
   * Helper to format academic year into standard year range (e.g. '2025 - 2026')
   */
  static formatYearRange(year) {
    if (!year) return '';
    let startY = null;
    let endY = null;
    if (year.start_date) {
      const match = String(year.start_date).match(/^(\d{4})/);
      if (match) startY = parseInt(match[1], 10);
    }
    if (year.end_date) {
      const match = String(year.end_date).match(/^(\d{4})/);
      if (match) endY = parseInt(match[1], 10);
    }
    if (!startY && year.academic_year) {
      const match = String(year.academic_year).match(/^(\d{4})/);
      if (match) startY = parseInt(match[1], 10);
    }
    if (startY) {
      if (endY && endY > startY) {
        return `${startY} - ${endY}`;
      }
      return `${startY} - ${startY + 1}`;
    }
    return year.academic_year || (year.id ? `Year ${year.id}` : '');
  }

  // Helper to format academic year display name (e.g. 'January 2026 - November 2026')
  static formatYearTitle(year) {
    if (!year) return '';
    if (year.start_date && year.end_date) {
      const parseMonthYear = (dateStr) => {
        if (!dateStr) return '';
        const match = String(dateStr).match(/^(\d{4})-(\d{1,2})/);
        if (match) {
          const y = match[1];
          const m = parseInt(match[2], 10) - 1;
          const monthNames = [
            'January', 'February', 'March', 'April', 'May', 'June',
            'July', 'August', 'September', 'October', 'November', 'December'
          ];
          if (m >= 0 && m < 12) return `${monthNames[m]} ${y}`;
        }
        const d = new Date(dateStr);
        if (!isNaN(d.getTime())) {
          return `${d.toLocaleString('en-US', { month: 'long' })} ${d.getFullYear()}`;
        }
        return dateStr;
      };
      const start = parseMonthYear(year.start_date);
      const end = parseMonthYear(year.end_date);
      if (start && end) {
        return `${start} - ${end}`;
      }
    }
    return AcademicModel.formatYearRange(year);
  }

  // ==================== ACADEMIC YEARS ====================
  static parseBranchId(branchId) {
    if (
      branchId !== null &&
      branchId !== undefined &&
      branchId !== '' &&
      branchId !== 'all' &&
      branchId !== '0' &&
      branchId !== 0 &&
      !isNaN(Number(branchId)) &&
      Number(branchId) > 0
    ) {
      return Number(branchId);
    }
    return null;
  }

  static async resolveDefaultBranchId(schoolId, branchId = null) {
    const parsed = AcademicModel.parseBranchId(branchId);
    if (parsed) return parsed;
    try {
      const [rows] = await pool.query(
        `SELECT id FROM branch_master WHERE school_id = ? AND status != 4 ORDER BY is_main_branch DESC, id ASC LIMIT 1`,
        [schoolId]
      );
      if (rows && rows.length > 0) return Number(rows[0].id);
    } catch (e) {}
    return null;
  }

  static async getAcademicYears(schoolId, branchId = null) {
    try {
      const cleanBranchId = AcademicModel.parseBranchId(branchId);

      let sql = `SELECT id, school_id, branch_id, academic_year, start_date, end_date, is_current, status 
         FROM academic_year_master 
         WHERE school_id = ? AND (status != 4 OR status IS NULL)`;
      const params = [schoolId];
      if (cleanBranchId) {
        sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        params.push(cleanBranchId);
      }
      sql += ` ORDER BY id ASC`;
      const [rows] = await pool.query(sql, params);
      if (rows && rows.length > 0) {
        // Ensure at least one academic year is marked as is_current = 1 in the active scope
        const hasCurrent = rows.some((r) => Number(r.is_current) === 1);
        if (!hasCurrent) {
          const fallbackRow = rows.find((r) => Number(r.status) === 1) || rows[0];
          if (fallbackRow) {
            await pool.query(
              `UPDATE academic_year_master SET is_current = 1 WHERE id = ? AND school_id = ?`,
              [fallbackRow.id, schoolId]
            );
            fallbackRow.is_current = 1;
          }
        } else if (cleanBranchId) {
          // If multiple rows in the same branch scope are marked current, keep only the latest one marked current
          const currentRows = rows.filter((r) => Number(r.is_current) === 1);
          if (currentRows.length > 1) {
            const keepRow = currentRows[currentRows.length - 1];
            for (const r of currentRows) {
              if (r.id !== keepRow.id) {
                await pool.query(
                  `UPDATE academic_year_master SET is_current = 0 WHERE id = ? AND school_id = ?`,
                  [r.id, schoolId]
                );
                r.is_current = 0;
              }
            }
          }
        }

        return rows.map((r) => {
          const isCurrent = Number(r.is_current) === 1;
          const range = AcademicModel.formatYearRange(r);
          const displayName = isCurrent ? `${range} (current)` : range;
          return {
            ...r,
            academic_year: displayName,
            raw_academic_year: r.academic_year,
            name: displayName,
            title: displayName,
            is_current: isCurrent ? 1 : 0,
            isCurrent: isCurrent,
          };
        });
      }
      return [];
    } catch (e) {
      console.error('Error in getAcademicYears:', e.message);
      return [];
    }
  }

  static async getAcademicYearById(id, schoolId, branchId = null) {
    try {
      const cleanBranchId = AcademicModel.parseBranchId(branchId);

      let sql = `SELECT id, school_id, branch_id, academic_year, start_date, end_date, is_current, status 
         FROM academic_year_master 
         WHERE id = ? AND school_id = ? AND (status != 4 OR status IS NULL)`;
      const params = [id, schoolId];
      if (cleanBranchId) {
        sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        params.push(cleanBranchId);
      }
      sql += ` LIMIT 1`;
      const [rows] = await pool.query(sql, params);
      if (rows && rows.length > 0) {
        return {
          ...rows[0],
          raw_academic_year: rows[0].academic_year,
          name: AcademicModel.formatYearTitle(rows[0]),
        };
      }
      return null;
    } catch (e) {
      console.error('Error in getAcademicYearById:', e.message);
      return null;
    }
  }

  static async createAcademicYear(schoolId, { name, academic_year, start_date, end_date, is_current = 0, status = 1, branch_id = null }) {
    const yearVal = String(academic_year || name || '').replace(/\s*\(current\)\s*$/i, '').trim();
    let isCurr = Number(is_current) === 1 || is_current === true || is_current === '1' ? 1 : 0;
    const branchVal = await AcademicModel.resolveDefaultBranchId(schoolId, branch_id);

    // Check if there is any existing current academic year in this school/branch scope
    let checkSql = `SELECT id FROM academic_year_master WHERE school_id = ? AND is_current = 1 AND (status != 4 OR status IS NULL)`;
    const checkParams = [schoolId];
    if (branchVal) {
      checkSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      checkParams.push(branchVal);
    } else {
      checkSql += ` AND branch_id IS NULL`;
    }
    checkSql += ` LIMIT 1`;
    const [existingCurrent] = await pool.query(checkSql, checkParams);

    if (isCurr === 0 && (!existingCurrent || existingCurrent.length === 0)) {
      const err = new Error('At least one academic year must be marked as current.');
      err.statusCode = 400;
      throw err;
    }

    if (isCurr === 1) {
      let resetSql = `UPDATE academic_year_master SET is_current = 0 WHERE school_id = ?`;
      const resetParams = [schoolId];
      if (branchVal) {
        resetSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        resetParams.push(branchVal);
      } else {
        resetSql += ` AND branch_id IS NULL`;
      }
      await pool.query(resetSql, resetParams);
    }

    const [result] = await pool.query(
      `INSERT INTO academic_year_master (school_id, branch_id, academic_year, start_date, end_date, is_current, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [schoolId, branchVal, yearVal, start_date, end_date, isCurr, Number(status)]
    );
    return result.insertId;
  }

  static async updateAcademicYear(id, schoolId, { name, academic_year, start_date, end_date, is_current = 0, status = 1, branch_id }, reqBranchId = null) {
    // Load the existing record to verify ownership and determine branch scope
    const filterBranch = AcademicModel.parseBranchId(reqBranchId);
    let existingSql = `SELECT id, school_id, branch_id, academic_year, start_date, end_date, is_current, status
                       FROM academic_year_master
                       WHERE id = ? AND school_id = ? AND (status != 4 OR status IS NULL)`;
    const existingParams = [id, schoolId];
    if (filterBranch) {
      existingSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      existingParams.push(filterBranch);
    }
    existingSql += ` LIMIT 1`;
    const [existingRows] = await pool.query(existingSql, existingParams);
    if (!existingRows || existingRows.length === 0) {
      return false;
    }
    const existing = existingRows[0];

    const rawYearInput = academic_year !== undefined ? academic_year : (name !== undefined ? name : existing.academic_year);
    const yearVal = String(rawYearInput || '').replace(/\s*\(current\)\s*$/i, '').trim();
    const startDateVal = start_date !== undefined ? start_date : existing.start_date;
    const endDateVal = end_date !== undefined ? end_date : existing.end_date;
    const statusVal = status !== undefined ? Number(status) : Number(existing.status);
    const isCurr = Number(is_current) === 1 || is_current === true || is_current === '1' ? 1 : 0;

    const parsedBodyBranch = branch_id !== undefined ? AcademicModel.parseBranchId(branch_id) : undefined;
    const effectiveBranchId =
      parsedBodyBranch !== undefined
        ? parsedBodyBranch
        : AcademicModel.parseBranchId(existing.branch_id) || filterBranch;

    // Check if any OTHER academic year in this school/branch scope has is_current = 1
    let otherCurrSql = `SELECT id FROM academic_year_master WHERE school_id = ? AND id != ? AND is_current = 1 AND (status != 4 OR status IS NULL)`;
    const otherCurrParams = [schoolId, id];
    if (effectiveBranchId) {
      otherCurrSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      otherCurrParams.push(effectiveBranchId);
    } else {
      otherCurrSql += ` AND branch_id IS NULL`;
    }
    otherCurrSql += ` LIMIT 1`;
    const [otherCurrentRows] = await pool.query(otherCurrSql, otherCurrParams);
    const hasOtherCurrent = otherCurrentRows && otherCurrentRows.length > 0;

    if (isCurr === 0 && (Number(existing.is_current) === 1 || !hasOtherCurrent)) {
      const err = new Error(
        'At least one academic year must remain marked as current. Please select another academic year as current instead of unchecking this one.'
      );
      err.statusCode = 400;
      throw err;
    }

    if (isCurr === 1) {
      let resetSql = `UPDATE academic_year_master SET is_current = 0 WHERE school_id = ? AND id != ?`;
      const resetParams = [schoolId, id];
      if (effectiveBranchId) {
        resetSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        resetParams.push(effectiveBranchId);
      } else {
        resetSql += ` AND branch_id IS NULL`;
      }
      await pool.query(resetSql, resetParams);
    }

    let updateSql = `UPDATE academic_year_master SET academic_year = ?, start_date = ?, end_date = ?, is_current = ?, status = ?`;
    const updateParams = [yearVal, startDateVal, endDateVal, isCurr, statusVal];
    if (parsedBodyBranch !== undefined) {
      updateSql += `, branch_id = ?`;
      updateParams.push(parsedBodyBranch);
    }
    updateSql += ` WHERE id = ? AND school_id = ?`;
    updateParams.push(id, schoolId);
    const [result] = await pool.query(updateSql, updateParams);
    return result.affectedRows > 0;
  }

  static async deleteAcademicYear(id, schoolId, branchId = null) {
    const cleanBranchId = AcademicModel.parseBranchId(branchId);
    // Check if the academic year is current (is_current = 1)
    let checkSql = `SELECT id, is_current, academic_year FROM academic_year_master WHERE id = ? AND school_id = ? AND (status != 4 OR status IS NULL)`;
    const checkParams = [id, schoolId];
    if (cleanBranchId) {
      checkSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      checkParams.push(cleanBranchId);
    }
    checkSql += ` LIMIT 1`;
    const [rows] = await pool.query(checkSql, checkParams);
    if (!rows || rows.length === 0) {
      return false;
    }
    if (Number(rows[0].is_current) === 1) {
      const err = new Error('Current academic year cannot be deleted.');
      err.statusCode = 400;
      throw err;
    }

    let sql = `UPDATE academic_year_master SET status = 4 WHERE id = ? AND school_id = ?`;
    const params = [id, schoolId];
    if (cleanBranchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(cleanBranchId);
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  // ==================== CLASSES ====================
  // Filter classes strictly by teacher_class_assign for teachers, status = 1
  static async getClasses(schoolId, activeOnly = false, teacherId = null, branchId = null) {
    const cleanBranchId = AcademicModel.parseBranchId(branchId);
    let sql = `SELECT c.*, bm.branch_name, bm.branch_code, s.shift_name FROM class_master c 
       LEFT JOIN branch_master bm ON c.branch_id = bm.id
       LEFT JOIN shift_master s ON c.shift_id = s.id 
       WHERE c.school_id = ?`;
    const params = [schoolId];
    if (activeOnly) {
      sql += ` AND c.status = 1`;
    } else {
      sql += ` AND (c.status != 4 OR c.status IS NULL)`;
    }
    if (cleanBranchId) {
      sql += ` AND c.branch_id = ?`;
      params.push(cleanBranchId);
    }
    if (teacherId) {
      sql += ` AND (
        EXISTS (
          SELECT 1 FROM teacher_class_assign tca 
          WHERE tca.teacher_id = ? AND tca.class_id = c.id AND tca.school_id = c.school_id AND tca.status = 1
        )
        OR EXISTS (
          SELECT 1 FROM teacher_master tm
          WHERE tm.id = ? AND tm.class = c.id AND tm.school_id = c.school_id AND tm.status = 1
        )
      )`;
      params.push(teacherId, teacherId);
    }
    sql += ` ORDER BY c.sort_order ASC, c.id DESC`;
    const [rows] = await pool.query(sql, params);
    return rows;
  }

  static async getClassById(id, schoolId, branchId = null) {
    const cleanBranchId = AcademicModel.parseBranchId(branchId);
    let sql = `SELECT c.*, bm.branch_name, bm.branch_code, s.shift_name FROM class_master c 
       LEFT JOIN branch_master bm ON c.branch_id = bm.id
       LEFT JOIN shift_master s ON c.shift_id = s.id 
       WHERE c.id = ? AND c.school_id = ? AND (c.status != 4 OR c.status IS NULL)`;
    const params = [id, schoolId];
    if (cleanBranchId) {
      sql += ` AND c.branch_id = ?`;
      params.push(cleanBranchId);
    }
    sql += ` LIMIT 1`;
    const [rows] = await pool.query(sql, params);
    return rows[0] || null;
  }

  static async createClass(schoolId, { class_name, shift_id = null, sort_order = 0, status = 1, branch_id = null }) {
    let resolvedBranchId = (branch_id && branch_id !== 'all') ? Number(branch_id) : null;
    if (!resolvedBranchId) {
      try {
        const [mainB] = await pool.query(
          `SELECT id FROM branch_master WHERE school_id = ? AND (is_main_branch = 1 OR id > 0) ORDER BY is_main_branch DESC, id ASC LIMIT 1`,
          [schoolId]
        );
        if (mainB && mainB.length > 0) resolvedBranchId = mainB[0].id;
      } catch (e) {}
    }

    // Branch-aware duplicate check: class_name within this school and branch
    if (class_name && String(class_name).trim()) {
      let dupSql = `SELECT id FROM class_master WHERE school_id = ? AND LOWER(TRIM(class_name)) = LOWER(TRIM(?)) AND (status != 4 OR status IS NULL)`;
      const dupParams = [schoolId, String(class_name).trim()];
      if (resolvedBranchId) {
        dupSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        dupParams.push(resolvedBranchId);
      }
      dupSql += ` LIMIT 1`;
      const [existing] = await pool.query(dupSql, dupParams);
      if (existing && existing.length > 0) {
        const err = new Error(`A class named "${class_name}" already exists in this branch.`);
        err.statusCode = 400;
        throw err;
      }
    }

    const [result] = await pool.query(
      `INSERT INTO class_master (school_id, branch_id, shift_id, class_name, sort_order, status) VALUES (?, ?, ?, ?, ?, ?)`,
      [schoolId, resolvedBranchId, shift_id, class_name, sort_order, status]
    );
    return result.insertId;
  }

  static async updateClass(id, schoolId, { class_name, shift_id, sort_order, status, branch_id = null }, branchId = null) {
    let targetBranchId = (branch_id && branch_id !== 'all') ? Number(branch_id) : ((branchId && branchId !== 'all') ? Number(branchId) : null);

    // Branch-aware duplicate check on update
    if (class_name && String(class_name).trim()) {
      let dupSql = `SELECT id FROM class_master WHERE school_id = ? AND LOWER(TRIM(class_name)) = LOWER(TRIM(?)) AND id != ? AND (status != 4 OR status IS NULL)`;
      const dupParams = [schoolId, String(class_name).trim(), id];
      if (targetBranchId) {
        dupSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        dupParams.push(targetBranchId);
      }
      dupSql += ` LIMIT 1`;
      const [existing] = await pool.query(dupSql, dupParams);
      if (existing && existing.length > 0) {
        const err = new Error(`Another class named "${class_name}" already exists in this branch.`);
        err.statusCode = 400;
        throw err;
      }
    }

    let sql = `UPDATE class_master SET class_name = ?, shift_id = ?, sort_order = ?, status = ?, branch_id = COALESCE(?, branch_id) WHERE id = ? AND school_id = ?`;
    const params = [class_name, shift_id, sort_order, status, branch_id || null, id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  static async deleteClass(id, schoolId, branchId = null) {
    let sql = `UPDATE class_master SET status = 4 WHERE id = ? AND school_id = ?`;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  // ==================== SECTIONS ====================
  static decodeIdValue(val) {
    if (val === null || val === undefined || val === '') return null;
    if (typeof val === 'number') return val;
    const str = String(val).trim();
    if (!str) return null;
    if (/^\d+$/.test(str)) return Number(str);
    try {
      const unescaped = decodeURIComponent(str);
      const decoded = Buffer.from(unescaped, 'base64').toString('utf8');
      if (/^\d+$/.test(decoded)) {
        const reEncoded = Buffer.from(decoded, 'utf8').toString('base64');
        if (reEncoded === unescaped || reEncoded.replace(/=+$/, '') === unescaped.replace(/=+$/, '')) {
          return Number(decoded);
        }
      }
    } catch (_) {}
    return val;
  }

  static async getSections(schoolId, classId = null, activeOnly = false, status = null, branchId = null, teacherId = null) {
    const cleanBranchId = AcademicModel.parseBranchId(branchId);
    const cleanClassId = AcademicModel.decodeIdValue(classId);
    let sql = `SELECT sec.*, bm.branch_name, bm.branch_code, c.class_name FROM section_master sec
       LEFT JOIN branch_master bm ON sec.branch_id = bm.id
       LEFT JOIN class_master c ON sec.class_id = c.id
       WHERE sec.school_id = ?`;
    const params = [schoolId];
    if (status !== null && status !== undefined && status !== '') {
      sql += ` AND sec.status = ?`;
      params.push(Number(status));
    } else if (activeOnly) {
      sql += ` AND sec.status = 1`;
    } else {
      sql += ` AND (sec.status != 4 OR sec.status IS NULL)`;
    }
    if (cleanClassId) {
      sql += ` AND sec.class_id = ?`;
      params.push(cleanClassId);
    } else if (cleanBranchId) {
      sql += ` AND (COALESCE(sec.branch_id, c.branch_id) = ? OR (sec.branch_id IS NULL AND c.branch_id IS NULL))`;
      params.push(cleanBranchId);
    }
    if (teacherId) {
      sql += ` AND (
        EXISTS (
          SELECT 1 FROM teacher_class_assign tca
          WHERE tca.teacher_id = ? AND tca.class_id = sec.class_id AND tca.school_id = sec.school_id AND tca.status = 1
        )
        OR EXISTS (
          SELECT 1 FROM teacher_master tm
          WHERE tm.id = ? AND tm.class = sec.class_id AND tm.school_id = sec.school_id AND tm.status = 1
        )
      )`;
      params.push(teacherId, teacherId);
    }
    sql += ` ORDER BY sec.sort_order ASC, sec.id ASC`;
    const [rows] = await pool.query(sql, params);
    return rows;
  }

  static async getSectionById(id, schoolId, branchId = null) {
    try {
      const cleanBranchId = AcademicModel.parseBranchId(branchId);
      let sql = `SELECT sec.*, bm.branch_name, bm.branch_code, c.class_name 
         FROM section_master sec
         LEFT JOIN branch_master bm ON sec.branch_id = bm.id
         LEFT JOIN class_master c ON sec.class_id = c.id
         WHERE sec.id = ? AND sec.school_id = ? AND (sec.status != 4 OR sec.status IS NULL)`;
      const params = [id, schoolId];
      if (cleanBranchId) {
        sql += ` AND COALESCE(sec.branch_id, c.branch_id) = ?`;
        params.push(cleanBranchId);
      }
      sql += ` LIMIT 1`;
      const [rows] = await pool.query(sql, params);
      return rows[0] || null;
    } catch (e) {
      console.error('Error in getSectionById:', e.message);
      return null;
    }
  }

  static async createSection(schoolId, { class_id, section_name, capacity = 40, note = '', sort_order = 1, status = 1, branch_id = null }) {
    let resolvedBranchId = (branch_id && branch_id !== 'all') ? Number(branch_id) : null;
    if (!resolvedBranchId && class_id) {
      try {
        const [cls] = await pool.query(`SELECT branch_id FROM class_master WHERE id = ? LIMIT 1`, [class_id]);
        if (cls && cls[0]?.branch_id) resolvedBranchId = cls[0].branch_id;
      } catch (e) {}
    }
    if (!resolvedBranchId) {
      try {
        const [mainB] = await pool.query(
          `SELECT id FROM branch_master WHERE school_id = ? AND is_main_branch = 1 LIMIT 1`,
          [schoolId]
        );
        if (mainB && mainB.length > 0) resolvedBranchId = mainB[0].id;
      } catch (e) {}
    }

    // Branch-aware duplicate check: section_name within same class and branch
    if (section_name && String(section_name).trim()) {
      let dupSql = `SELECT id FROM section_master WHERE school_id = ? AND class_id = ? AND LOWER(TRIM(section_name)) = LOWER(TRIM(?)) AND (status != 4 OR status IS NULL)`;
      const dupParams = [schoolId, class_id, String(section_name).trim()];
      if (resolvedBranchId) {
        dupSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        dupParams.push(resolvedBranchId);
      }
      dupSql += ` LIMIT 1`;
      const [existing] = await pool.query(dupSql, dupParams);
      if (existing && existing.length > 0) {
        const err = new Error(`A section named "${section_name}" already exists for this class in this branch.`);
        err.statusCode = 400;
        throw err;
      }
    }

    const [result] = await pool.query(
      `INSERT INTO section_master (school_id, branch_id, class_id, section_name, capacity, note, sort_order, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [schoolId, resolvedBranchId, class_id, section_name, Number(capacity) || 0, note || '', Number(sort_order) || 1, Number(status)]
    );
    return result.insertId;
  }

  static async updateSection(id, schoolId, { class_id, section_name, capacity, note, sort_order, status, branch_id = null }, branchId = null) {
    let targetBranchId = (branch_id && branch_id !== 'all') ? Number(branch_id) : ((branchId && branchId !== 'all') ? Number(branchId) : null);

    // Branch-aware duplicate check on update
    if (section_name && String(section_name).trim() && class_id) {
      let dupSql = `SELECT id FROM section_master WHERE school_id = ? AND class_id = ? AND LOWER(TRIM(section_name)) = LOWER(TRIM(?)) AND id != ? AND (status != 4 OR status IS NULL)`;
      const dupParams = [schoolId, class_id, String(section_name).trim(), id];
      if (targetBranchId) {
        dupSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        dupParams.push(targetBranchId);
      }
      dupSql += ` LIMIT 1`;
      const [existing] = await pool.query(dupSql, dupParams);
      if (existing && existing.length > 0) {
        const err = new Error(`Another section named "${section_name}" already exists for this class in this branch.`);
        err.statusCode = 400;
        throw err;
      }
    }

    let sql = `UPDATE section_master SET class_id = ?, section_name = ?, capacity = ?, note = ?, sort_order = ?, status = ? WHERE id = ? AND school_id = ?`;
    const params = [class_id, section_name, Number(capacity) || 0, note || '', Number(sort_order) || 0, Number(status), id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  static async deleteSection(id, schoolId, branchId = null) {
    let sql = `UPDATE section_master SET status = 4 WHERE id = ? AND school_id = ?`;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  // ==================== SUBJECTS ====================
  // Filter subjects strictly by teacher_class_assign for teachers, status = 1
  static async getSubjects(schoolId, classId = null, activeOnly = false, teacherId = null, branchId = null) {
    const cleanBranchId = AcademicModel.parseBranchId(branchId);
    let sql = `SELECT sm.*, cm.class_name, bm.branch_name, bm.branch_code 
               FROM subject_master sm
               LEFT JOIN class_master cm ON sm.class_id = cm.id
               LEFT JOIN branch_master bm ON COALESCE(sm.branch_id, cm.branch_id) = bm.id
               WHERE sm.school_id = ?`;
    const params = [schoolId];

    if (activeOnly) {
      sql += ` AND sm.status = 1`;
    } else {
      sql += ` AND (sm.status != 4 OR sm.status IS NULL)`;
    }

    if (cleanBranchId) {
      sql += ` AND COALESCE(sm.branch_id, cm.branch_id) = ?`;
      params.push(cleanBranchId);
    }

    if (classId) {
      sql += ` AND sm.class_id = ?`;
      params.push(classId);
    }

    if (teacherId) {
      sql += ` AND (
        EXISTS (
          SELECT 1 FROM teacher_class_assign tca 
          WHERE tca.teacher_id = ? AND tca.subject_id = sm.id AND tca.school_id = sm.school_id AND tca.status = 1
          ${classId ? 'AND tca.class_id = ?' : ''}
        )
        OR EXISTS (
          SELECT 1 FROM teacher_master tm
          WHERE tm.id = ? AND tm.subject = sm.id AND tm.school_id = sm.school_id AND tm.status = 1
          ${classId ? 'AND (tm.class = ? OR sm.class_id = ?)' : ''}
        )
      )`;
      params.push(teacherId);
      if (classId) {
        params.push(classId);
      }
      params.push(teacherId);
      if (classId) {
        params.push(classId, classId);
      }
    }

    sql += ` ORDER BY sm.sort_order ASC, sm.id ASC`;
    const [rows] = await pool.query(sql, params);
    return rows;
  }

  static async getSubjectById(id, schoolId, branchId = null) {
    try {
      const cleanBranchId = AcademicModel.parseBranchId(branchId);
      let sql = `SELECT sm.*, cm.class_name, bm.branch_name, bm.branch_code 
         FROM subject_master sm 
         LEFT JOIN class_master cm ON sm.class_id = cm.id 
         LEFT JOIN branch_master bm ON COALESCE(sm.branch_id, cm.branch_id) = bm.id
         WHERE sm.id = ? AND sm.school_id = ? AND (sm.status != 4 OR sm.status IS NULL)`;
      const params = [id, schoolId];
      if (cleanBranchId) {
        sql += ` AND COALESCE(sm.branch_id, cm.branch_id) = ?`;
        params.push(cleanBranchId);
      }
      sql += ` LIMIT 1`;
      const [rows] = await pool.query(sql, params);
      return rows[0] || null;
    } catch (e) {
      console.error('Error in getSubjectById:', e.message);
      return null;
    }
  }

  static async createSubject(schoolId, { class_id = null, class_ids = null, subject_name, sort_order = 1, status = 1, branch_id = null }) {
    const targetClasses = Array.isArray(class_ids) && class_ids.length > 0
      ? class_ids
      : Array.isArray(class_id) && class_id.length > 0
      ? class_id
      : [class_id];

    const insertedIds = [];
    let lastError = null;

    for (const cId of targetClasses) {
      let resolvedBranchId = branch_id ? Number(branch_id) : null;
      if (!resolvedBranchId && cId) {
        try {
          const [cls] = await pool.query(`SELECT branch_id FROM class_master WHERE id = ? LIMIT 1`, [cId]);
          if (cls && cls[0]?.branch_id) resolvedBranchId = cls[0].branch_id;
        } catch (e) {}
      }

      // Branch-aware duplicate check: subject_name within branch and class
      if (subject_name && String(subject_name).trim()) {
        let dupSql = `SELECT id FROM subject_master WHERE school_id = ? AND LOWER(TRIM(subject_name)) = LOWER(TRIM(?)) AND (status != 4 OR status IS NULL)`;
        const dupParams = [schoolId, String(subject_name).trim()];
        if (cId) {
          dupSql += ` AND class_id = ?`;
          dupParams.push(cId);
        }
        if (resolvedBranchId) {
          dupSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
          dupParams.push(resolvedBranchId);
        }
        dupSql += ` LIMIT 1`;
        const [existing] = await pool.query(dupSql, dupParams);
        if (existing && existing.length > 0) {
          const err = new Error(`A subject named "${subject_name}" already exists for this class.`);
          err.statusCode = 400;
          if (targetClasses.length === 1) throw err;
          lastError = err;
          continue;
        }
      }

      const [result] = await pool.query(
        `INSERT INTO subject_master (school_id, branch_id, class_id, subject_name, sort_order, status) VALUES (?, ?, ?, ?, ?, ?)`,
        [schoolId, resolvedBranchId, cId ? Number(cId) : null, subject_name, Number(sort_order) || 0, Number(status)]
      );
      insertedIds.push(result.insertId);
    }

    if (insertedIds.length === 0 && lastError) {
      throw lastError;
    }

    return insertedIds[0] || null;
  }

  static async updateSubject(id, schoolId, { class_id, subject_name, sort_order = 1, status = 1, branch_id = null }, branchId = null) {
    const targetBranchId = branch_id ? Number(branch_id) : (branchId ? Number(branchId) : null);

    // Branch-aware duplicate check on update
    if (subject_name && String(subject_name).trim()) {
      let dupSql = `SELECT id FROM subject_master WHERE school_id = ? AND LOWER(TRIM(subject_name)) = LOWER(TRIM(?)) AND id != ? AND (status != 4 OR status IS NULL)`;
      const dupParams = [schoolId, String(subject_name).trim(), id];
      if (class_id) {
        dupSql += ` AND class_id = ?`;
        dupParams.push(class_id);
      }
      if (targetBranchId) {
        dupSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        dupParams.push(targetBranchId);
      }
      dupSql += ` LIMIT 1`;
      const [existing] = await pool.query(dupSql, dupParams);
      if (existing && existing.length > 0) {
        const err = new Error(`Another subject named "${subject_name}" already exists in this branch.`);
        err.statusCode = 400;
        throw err;
      }
    }

    let sql = `UPDATE subject_master SET class_id = ?, subject_name = ?, sort_order = ?, status = ?`;
    const params = [class_id ? Number(class_id) : null, subject_name, Number(sort_order) || 0, Number(status)];
    if (targetBranchId) {
      sql += `, branch_id = ?`;
      params.push(targetBranchId);
    }
    sql += ` WHERE id = ? AND school_id = ?`;
    params.push(id, schoolId);
    if (branchId && branchId !== 'all') {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  static async deleteSubject(id, schoolId, branchId = null) {
    let sql = `UPDATE subject_master SET status = 4 WHERE id = ? AND school_id = ?`;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  // ==================== SHIFTS ====================
  static async getShifts(schoolId, activeOnly = false, branchId = null) {
    let sql = `SELECT s.*, bm.branch_name, bm.branch_code 
               FROM shift_master s 
               LEFT JOIN branch_master bm ON s.branch_id = bm.id 
               WHERE s.school_id = ?`;
    const params = [schoolId];
    if (activeOnly) {
      sql += ` AND s.status = 1`;
    } else {
      sql += ` AND (s.status != 4 OR s.status IS NULL)`;
    }
    if (branchId) {
      sql += ` AND (s.branch_id = ? OR s.branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    sql += ` ORDER BY s.id ASC`;
    const [rows] = await pool.query(sql, params);
    return rows;
  }

  static async getShiftById(id, schoolId, branchId = null) {
    let sql = `SELECT s.*, bm.branch_name, bm.branch_code 
       FROM shift_master s 
       LEFT JOIN branch_master bm ON s.branch_id = bm.id 
       WHERE s.id = ? AND s.school_id = ?`;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND (s.branch_id = ? OR s.branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    sql += ` LIMIT 1`;
    const [rows] = await pool.query(sql, params);
    return rows[0] || null;
  }

  static async createShift(schoolId, { branch_id = null, shift_name, start_time = null, end_time = null, status = 1 }) {
    const resolvedBranchId = branch_id ? Number(branch_id) : null;

    if (shift_name && String(shift_name).trim()) {
      let dupSql = `SELECT id FROM shift_master WHERE school_id = ? AND LOWER(TRIM(shift_name)) = LOWER(TRIM(?)) AND (status != 4 OR status IS NULL)`;
      const dupParams = [schoolId, String(shift_name).trim()];
      if (resolvedBranchId) {
        dupSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        dupParams.push(resolvedBranchId);
      }
      dupSql += ` LIMIT 1`;
      const [existing] = await pool.query(dupSql, dupParams);
      if (existing && existing.length > 0) {
        const err = new Error(`A shift named "${shift_name}" already exists in this branch.`);
        err.statusCode = 400;
        throw err;
      }
    }

    const [result] = await pool.query(
      `INSERT INTO shift_master (school_id, branch_id, shift_name, start_time, end_time, status) VALUES (?, ?, ?, ?, ?, ?)`,
      [schoolId, resolvedBranchId, shift_name, start_time, end_time, status]
    );
    return result.insertId;
  }

  static async updateShift(id, schoolId, { branch_id, shift_name, start_time, end_time, status = 1 }, branchId = null) {
    const resolvedBranchId = branch_id !== undefined ? (branch_id ? Number(branch_id) : null) : (branchId ? Number(branchId) : null);

    if (shift_name && String(shift_name).trim()) {
      let dupSql = `SELECT id FROM shift_master WHERE school_id = ? AND LOWER(TRIM(shift_name)) = LOWER(TRIM(?)) AND id != ? AND (status != 4 OR status IS NULL)`;
      const dupParams = [schoolId, String(shift_name).trim(), id];
      if (resolvedBranchId) {
        dupSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        dupParams.push(resolvedBranchId);
      }
      dupSql += ` LIMIT 1`;
      const [existing] = await pool.query(dupSql, dupParams);
      if (existing && existing.length > 0) {
        const err = new Error(`Another shift named "${shift_name}" already exists in this branch.`);
        err.statusCode = 400;
        throw err;
      }
    }

    let sql = `UPDATE shift_master SET shift_name = ?, start_time = ?, end_time = ?, status = ?, branch_id = COALESCE(?, branch_id) WHERE id = ? AND school_id = ?`;
    const params = [shift_name, start_time, end_time, status, resolvedBranchId, id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  static async deleteShift(id, schoolId, branchId = null) {
    let sql = `UPDATE shift_master SET status = 4 WHERE id = ? AND school_id = ?`;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  // ==================== HOUSES ====================
  static async getHouses(schoolId, branchId = null) {
    let sql = `SELECT h.*, bm.branch_name, bm.branch_code 
               FROM house_master h 
               LEFT JOIN branch_master bm ON h.branch_id = bm.id 
               WHERE h.school_id = ? AND (h.status != 4 OR h.status IS NULL)`;
    const params = [schoolId];
    if (branchId) {
      sql += ` AND (h.branch_id = ? OR h.branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    sql += ` ORDER BY h.sort_order ASC, h.id ASC`;
    const [rows] = await pool.query(sql, params);
    return rows;
  }

  static async getHouseById(id, schoolId, branchId = null) {
    try {
      let sql = `SELECT h.*, bm.branch_name, bm.branch_code 
         FROM house_master h 
         LEFT JOIN branch_master bm ON h.branch_id = bm.id 
         WHERE h.id = ? AND h.school_id = ? AND h.status != 4`;
      const params = [id, schoolId];
      if (branchId) {
        sql += ` AND (h.branch_id = ? OR h.branch_id IS NULL)`;
        params.push(Number(branchId));
      }
      sql += ` LIMIT 1`;
      const [rows] = await pool.query(sql, params);
      return rows[0] || null;
    } catch (e) {
      console.error('Error in getHouseById:', e.message);
      return null;
    }
  }

  static async createHouse(schoolId, { branch_id = null, house_name, sort_order = 1, status = 1 }) {
    const resolvedBranchId = branch_id ? Number(branch_id) : null;

    if (house_name && String(house_name).trim()) {
      let dupSql = `SELECT id FROM house_master WHERE school_id = ? AND LOWER(TRIM(house_name)) = LOWER(TRIM(?)) AND (status != 4 OR status IS NULL)`;
      const dupParams = [schoolId, String(house_name).trim()];
      if (resolvedBranchId) {
        dupSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        dupParams.push(resolvedBranchId);
      }
      dupSql += ` LIMIT 1`;
      const [existing] = await pool.query(dupSql, dupParams);
      if (existing && existing.length > 0) {
        const err = new Error(`A house named "${house_name}" already exists in this branch.`);
        err.statusCode = 400;
        throw err;
      }
    }

    const [result] = await pool.query(
      `INSERT INTO house_master (school_id, branch_id, house_name, sort_order, status) VALUES (?, ?, ?, ?, ?)`,
      [schoolId, resolvedBranchId, house_name, Number(sort_order) || 1, Number(status)]
    );
    return result.insertId;
  }

  static async updateHouse(id, schoolId, { branch_id, house_name, sort_order = 1, status = 1 }, branchId = null) {
    const resolvedBranchId = branch_id !== undefined ? (branch_id ? Number(branch_id) : null) : (branchId ? Number(branchId) : null);

    if (house_name && String(house_name).trim()) {
      let dupSql = `SELECT id FROM house_master WHERE school_id = ? AND LOWER(TRIM(house_name)) = LOWER(TRIM(?)) AND id != ? AND (status != 4 OR status IS NULL)`;
      const dupParams = [schoolId, String(house_name).trim(), id];
      if (resolvedBranchId) {
        dupSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        dupParams.push(resolvedBranchId);
      }
      dupSql += ` LIMIT 1`;
      const [existing] = await pool.query(dupSql, dupParams);
      if (existing && existing.length > 0) {
        const err = new Error(`Another house named "${house_name}" already exists in this branch.`);
        err.statusCode = 400;
        throw err;
      }
    }

    let sql = `UPDATE house_master SET house_name = ?, sort_order = ?, status = ?, branch_id = COALESCE(?, branch_id) WHERE id = ? AND school_id = ?`;
    const params = [house_name, Number(sort_order) || 1, Number(status), resolvedBranchId, id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  static async deleteHouse(id, schoolId, branchId = null) {
    let sql = `UPDATE house_master SET status = 4 WHERE id = ? AND school_id = ?`;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  // ==================== PERIODS ====================
  static parsePeriodTimeToSeconds(timeVal) {
    if (!timeVal) return null;
    const match = String(timeVal).trim().match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
    if (!match) return null;
    const hours = Number(match[1]);
    const minutes = Number(match[2]);
    const seconds = Number(match[3] || 0);
    if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59 || seconds < 0 || seconds > 59) {
      return null;
    }
    return hours * 3600 + minutes * 60 + seconds;
  }

  static formatPeriodTime12h(timeVal) {
    if (!timeVal) return '';
    const match = String(timeVal).trim().match(/^(\d{1,2}):(\d{2})/);
    if (!match) return String(timeVal);
    let hours = Number(match[1]);
    const minutes = match[2];
    const ampm = hours >= 12 ? 'PM' : 'AM';
    hours = hours % 12 || 12;
    return `${String(hours).padStart(2, '0')}:${minutes} ${ampm}`;
  }

  static async validatePeriodData(schoolId, { id = null, branch_id = null, shift_id = null, period_name, start_time = null, end_time = null }) {
    const resolvedBranchId = branch_id ? Number(branch_id) : null;
    const resolvedShiftId = shift_id ? Number(shift_id) : null;
    const trimmedName = period_name ? String(period_name).trim() : '';

    if (!resolvedShiftId) {
      const err = new Error('Please select a Shift.');
      err.statusCode = 400;
      throw err;
    }
    if (!trimmedName) {
      const err = new Error('Please enter Period Name.');
      err.statusCode = 400;
      throw err;
    }
    if (!start_time) {
      const err = new Error('Please select Start Time.');
      err.statusCode = 400;
      throw err;
    }
    if (!end_time) {
      const err = new Error('Please select End Time.');
      err.statusCode = 400;
      throw err;
    }

    const pStart = AcademicModel.parsePeriodTimeToSeconds(start_time);
    const pEnd = AcademicModel.parsePeriodTimeToSeconds(end_time);
    if (pStart === null || pEnd === null) {
      const err = new Error('Invalid start time or end time format.');
      err.statusCode = 400;
      throw err;
    }

    let shiftSql = `SELECT id, branch_id, shift_name, start_time, end_time, status FROM shift_master WHERE id = ? AND school_id = ? AND (status != 4 OR status IS NULL)`;
    const shiftParams = [resolvedShiftId, schoolId];
    if (resolvedBranchId) {
      shiftSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      shiftParams.push(resolvedBranchId);
    }
    shiftSql += ` LIMIT 1`;
    const [shiftRows] = await pool.query(shiftSql, shiftParams);
    const shiftRecord = shiftRows[0] || null;

    if (!shiftRecord) {
      const err = new Error('Selected shift was not found.');
      err.statusCode = 400;
      throw err;
    }

    const shiftLabel = String(shiftRecord.shift_name || '').trim() || 'selected shift';
    const sStart = AcademicModel.parsePeriodTimeToSeconds(shiftRecord.start_time);
    const sEnd = AcademicModel.parsePeriodTimeToSeconds(shiftRecord.end_time);
    const DAY_SECONDS = 24 * 3600;
    const isOvernightShift = sStart !== null && sEnd !== null && sEnd <= sStart;

    let normPStart = pStart;
    let normPEnd = pEnd;

    if (sStart !== null && sEnd !== null) {
      if (!isOvernightShift) {
        if (pEnd <= pStart) {
          const err = new Error('End time must be after start time.');
          err.statusCode = 400;
          throw err;
        }
        if (pStart < sStart) {
          const err = new Error(
            `Start time (${AcademicModel.formatPeriodTime12h(start_time)}) cannot be earlier than ${shiftLabel} start time (${AcademicModel.formatPeriodTime12h(shiftRecord.start_time)}).`
          );
          err.statusCode = 400;
          throw err;
        }
        if (pEnd > sEnd) {
          const err = new Error(
            `End time (${AcademicModel.formatPeriodTime12h(end_time)}) cannot exceed ${shiftLabel} end time (${AcademicModel.formatPeriodTime12h(shiftRecord.end_time)}).`
          );
          err.statusCode = 400;
          throw err;
        }
      } else {
        const windowStart = sStart;
        const windowEnd = sEnd + DAY_SECONDS;
        normPStart = pStart < sStart ? pStart + DAY_SECONDS : pStart;
        normPEnd = pEnd <= pStart ? pEnd + DAY_SECONDS : (pStart < sStart ? pEnd + DAY_SECONDS : pEnd);
        if (normPEnd <= normPStart) {
          const err = new Error('End time must be after start time.');
          err.statusCode = 400;
          throw err;
        }
        if (normPStart < windowStart || normPEnd > windowEnd) {
          const err = new Error(
            `Selected time (${AcademicModel.formatPeriodTime12h(start_time)} - ${AcademicModel.formatPeriodTime12h(end_time)}) must be within ${shiftLabel} timing (${AcademicModel.formatPeriodTime12h(shiftRecord.start_time)} - ${AcademicModel.formatPeriodTime12h(shiftRecord.end_time)}).`
          );
          err.statusCode = 400;
          throw err;
        }
      }
    } else if (pEnd <= pStart) {
      const err = new Error('End time must be after start time.');
      err.statusCode = 400;
      throw err;
    }

    const effectiveBranchId = resolvedBranchId || (shiftRecord.branch_id ? Number(shiftRecord.branch_id) : null);

    // 1. Check duplicate period name within the same shift
    let dupSql = `SELECT id FROM period_master WHERE school_id = ? AND shift_id = ? AND LOWER(TRIM(period_name)) = LOWER(TRIM(?)) AND (status != 4 OR status IS NULL)`;
    const dupParams = [schoolId, resolvedShiftId, trimmedName];
    if (id) {
      dupSql += ` AND id != ?`;
      dupParams.push(id);
    }
    if (effectiveBranchId) {
      dupSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      dupParams.push(effectiveBranchId);
    }
    dupSql += ` LIMIT 1`;
    const [existingName] = await pool.query(dupSql, dupParams);
    if (existingName && existingName.length > 0) {
      const err = new Error(`A period named "${trimmedName}" already exists under ${shiftLabel}.`);
      err.statusCode = 400;
      throw err;
    }

    // 2. Check duplicate or overlapping period timings within the same shift
    let overlapSql = `SELECT id, period_name, start_time, end_time FROM period_master WHERE school_id = ? AND shift_id = ? AND (status != 4 OR status IS NULL)`;
    const overlapParams = [schoolId, resolvedShiftId];
    if (id) {
      overlapSql += ` AND id != ?`;
      overlapParams.push(id);
    }
    if (effectiveBranchId) {
      overlapSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      overlapParams.push(effectiveBranchId);
    }
    const [existingPeriods] = await pool.query(overlapSql, overlapParams);

    for (const ep of existingPeriods) {
      const eStart = AcademicModel.parsePeriodTimeToSeconds(ep.start_time);
      const eEnd = AcademicModel.parsePeriodTimeToSeconds(ep.end_time);
      if (eStart === null || eEnd === null) continue;

      let normEStart = eStart;
      let normEEnd = eEnd;
      if (isOvernightShift) {
        normEStart = eStart < sStart ? eStart + DAY_SECONDS : eStart;
        normEEnd = eEnd <= eStart ? eEnd + DAY_SECONDS : (eStart < sStart ? eEnd + DAY_SECONDS : eEnd);
      }

      if (normPStart === normEStart && normPEnd === normEEnd) {
        const err = new Error(
          `The time slot ${AcademicModel.formatPeriodTime12h(ep.start_time)} - ${AcademicModel.formatPeriodTime12h(ep.end_time)} is already assigned to "${ep.period_name}" under ${shiftLabel}.`
        );
        err.statusCode = 400;
        throw err;
      }

      if (normPStart < normEEnd && normPEnd > normEStart) {
        const err = new Error(
          `Selected time (${AcademicModel.formatPeriodTime12h(start_time)} - ${AcademicModel.formatPeriodTime12h(end_time)}) overlaps with existing period "${ep.period_name}" (${AcademicModel.formatPeriodTime12h(ep.start_time)} - ${AcademicModel.formatPeriodTime12h(ep.end_time)}) under ${shiftLabel}.`
        );
        err.statusCode = 400;
        throw err;
      }
    }

    return {
      effectiveBranchId,
      resolvedShiftId,
      trimmedName,
    };
  }

  static async getPeriods(schoolId, branchId = null) {
    let sql = `SELECT p.*, bm.branch_name, bm.branch_code, s.shift_name, s.start_time AS shift_start_time, s.end_time AS shift_end_time 
       FROM period_master p 
       LEFT JOIN branch_master bm ON p.branch_id = bm.id 
       LEFT JOIN shift_master s ON p.shift_id = s.id 
       WHERE p.school_id = ? AND (p.status != 4 OR p.status IS NULL)`;
    const params = [schoolId];
    if (branchId) {
      sql += ` AND (p.branch_id = ? OR p.branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    sql += ` ORDER BY p.id ASC`;
    const [rows] = await pool.query(sql, params);
    return rows;
  }

  static async getPeriodById(id, schoolId, branchId = null) {
    try {
      let sql = `SELECT p.*, bm.branch_name, bm.branch_code, s.shift_name, s.start_time AS shift_start_time, s.end_time AS shift_end_time 
         FROM period_master p 
         LEFT JOIN branch_master bm ON p.branch_id = bm.id 
         LEFT JOIN shift_master s ON p.shift_id = s.id 
         WHERE p.id = ? AND p.school_id = ? AND p.status != 4`;
      const params = [id, schoolId];
      if (branchId) {
        sql += ` AND (p.branch_id = ? OR p.branch_id IS NULL)`;
        params.push(Number(branchId));
      }
      sql += ` LIMIT 1`;
      const [rows] = await pool.query(sql, params);
      return rows[0] || null;
    } catch (e) {
      console.error('Error in getPeriodById:', e.message);
      return null;
    }
  }

  static async createPeriod(schoolId, { branch_id = null, shift_id = null, period_name, start_time = null, end_time = null, status = 1 }) {
    const { effectiveBranchId, resolvedShiftId, trimmedName } = await AcademicModel.validatePeriodData(schoolId, {
      branch_id,
      shift_id,
      period_name,
      start_time,
      end_time,
    });

    const [result] = await pool.query(
      `INSERT INTO period_master (school_id, branch_id, shift_id, period_name, start_time, end_time, status) VALUES (?, ?, ?, ?, ?, ?, ?)`,
      [schoolId, effectiveBranchId, resolvedShiftId, trimmedName, start_time, end_time, Number(status)]
    );
    return result.insertId;
  }

  static async updatePeriod(id, schoolId, { branch_id, shift_id = null, period_name, start_time, end_time, status }, branchId = null) {
    const resolvedBranchId = branch_id !== undefined ? (branch_id ? Number(branch_id) : null) : (branchId ? Number(branchId) : null);

    const { effectiveBranchId, resolvedShiftId, trimmedName } = await AcademicModel.validatePeriodData(schoolId, {
      id,
      branch_id: resolvedBranchId,
      shift_id,
      period_name,
      start_time,
      end_time,
    });

    let sql = `UPDATE period_master SET shift_id = ?, period_name = ?, start_time = ?, end_time = ?, status = ?, branch_id = COALESCE(?, branch_id) WHERE id = ? AND school_id = ?`;
    const params = [resolvedShiftId, trimmedName, start_time, end_time, Number(status), effectiveBranchId, id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  static async deletePeriod(id, schoolId, branchId = null) {
    let sql = `UPDATE period_master SET status = 4 WHERE id = ? AND school_id = ?`;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  // ==================== LOOKUPS FOR ADD STUDENT ====================
  static async getCountries() {
    try {
      const [rows] = await pool.query(
        `SELECT id, name, name AS country, name AS country_name, shortname, phonecode 
         FROM countries 
         WHERE (status != 4 AND status != 0) OR status IS NULL OR status = 1 
         ORDER BY name ASC`
      );
      return rows || [];
    } catch (e) {
      console.error('Error in getCountries:', e.message);
      return [];
    }
  }

  static async getStates(countryId) {
    try {
      let sql = `SELECT id_state AS id, state, state AS name, country_id FROM states WHERE (is_active = 1 OR is_active IS NULL)`;
      const params = [];
      if (countryId) {
        sql += ` AND country_id = ?`;
        params.push(countryId);
      }
      sql += ` ORDER BY state ASC`;
      const [rows] = await pool.query(sql, params);
      return rows || [];
    } catch (e) {
      console.error('Error in getStates:', e.message);
      return [];
    }
  }

  static async getCities(stateId) {
    try {
      if (!stateId) return [];
      const sql = `SELECT id, name, name AS city, state_id FROM cities WHERE state_id = ? ORDER BY name ASC`;
      const [rows] = await pool.query(sql, [stateId]);
      return rows || [];
    } catch (e) {
      console.error('[AcademicModel.getCities] Error:', e.message);
      return [];
    }
  }

  static async getTransportRoutes(schoolId, branchId = null) {
    try {
      let sql = `SELECT id, school_id, branch_id, transport_route, bus_id, sort_order, status, fare 
         FROM trans_route_master 
         WHERE school_id = ? 
           AND status != 4`;
      const params = [schoolId];
      if (branchId) {
        sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        params.push(Number(branchId));
      }
      sql += ` ORDER BY id DESC`;
      const [rows] = await pool.query(sql, params);
      return rows || [];
    } catch (e) {
      console.error('Error in getTransportRoutes:', e.message);
      return [];
    }
  }

  static async getHostels(schoolId, branchId = null) {
    try {
      let sql = `SELECT id, school_id, branch_id, hostel_name, sort_order, status, hostel_fee 
         FROM hostel_name_master 
         WHERE status != 4 AND school_id = ?`;
      const params = [schoolId];
      if (branchId) {
        sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        params.push(Number(branchId));
      }
      sql += ` ORDER BY sort_order ASC, id ASC`;
      const [rows] = await pool.query(sql, params);
      return rows || [];
    } catch (e) {
      console.error('Error fetching hostels:', e.message);
      return [];
    }
  }

  static async getHostelRooms(hostelId, schoolId, branchId = null) {
    try {
      let sql = `
        SELECT 
          hrm.id, 
          hrm.hostel_id, 
          hrm.room_number, 
          hrm.status,
          hrm.sort_order,
          hnm.hostel_name
        FROM hostel_room_master hrm
        LEFT JOIN hostel_name_master hnm ON hrm.hostel_id = hnm.id
        WHERE hrm.status != 4
      `;
      const params = [];
      if (schoolId) {
        sql += ` AND hrm.school_id = ?`;
        params.push(schoolId);
      }
      if (branchId) {
        sql += ` AND (hrm.branch_id = ? OR hrm.branch_id IS NULL)`;
        params.push(Number(branchId));
      }
      if (hostelId) {
        sql += ` AND (hrm.hostel_id = ? OR hnm.hostel_name = ?)`;
        params.push(hostelId, hostelId);
      }
      sql += ` ORDER BY hrm.sort_order ASC, hrm.room_number ASC`;
      const [rows] = await pool.query(sql, params);
      return rows || [];
    } catch (e) {
      console.error('Error in getHostelRooms:', e.message);
      return [];
    }
  }

  static async getDocumentTypes(schoolId, branchId = null) {
    try {
      let sql = `SELECT id, school_id, branch_id, document_type_name, status 
         FROM document_type_master 
         WHERE school_id = ? AND (status != 4 OR status IS NULL)`;
      const params = [schoolId];
      if (branchId) {
        sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        params.push(Number(branchId));
      }
      sql += ` ORDER BY id ASC`;
      const [rows] = await pool.query(sql, params);
      return rows || [];
    } catch (e) {
      console.error('Error in getDocumentTypes:', e.message);
      return [];
    }
  }

  static async getDocumentTypeById(id, schoolId, branchId = null) {
    try {
      let sql = `SELECT id, school_id, branch_id, document_type_name, status 
         FROM document_type_master 
         WHERE id = ? AND school_id = ? AND (status != 4 OR status IS NULL)`;
      const params = [id, schoolId];
      if (branchId) {
        sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        params.push(Number(branchId));
      }
      sql += ` LIMIT 1`;
      const [rows] = await pool.query(sql, params);
      return rows[0] || null;
    } catch (e) {
      console.error('Error in getDocumentTypeById:', e.message);
      return null;
    }
  }

  static async getGenders() {
    try {
      const [rows] = await pool.query(`SELECT id, gender FROM gender_master ORDER BY id ASC`);
      return rows || [];
    } catch (e) {
      console.error('Error in getGenders:', e.message);
      return [];
    }
  }

  static async getBloodGroups() {
    try {
      const [rows] = await pool.query(`SELECT id, blood_group, blood_group AS name FROM blood_group_master ORDER BY id ASC`);
      return rows || [];
    } catch (e) {
      console.error('Error in getBloodGroups:', e.message);
      return [];
    }
  }

  static async getMaritalStatuses() {
    try {
      const [rows] = await pool.query(
        `SELECT id, marital_status, marital_status AS name FROM marital_master WHERE (status = 1 OR status IS NULL) ORDER BY id ASC`
      );
      return rows || [];
    } catch (e) {
      console.error('Error in getMaritalStatuses:', e.message);
      return [];
    }
  }

  static async getReligions(schoolId) {
    try {
      const [rows] = await pool.query(
        `SELECT id, religion, status FROM religion_master WHERE school_id = ? AND status = 1 ORDER BY sort_order ASC, id ASC`,
        [schoolId]
      );
      return rows || [];
    } catch (e) {
      console.error('Error in getReligions:', e.message);
      return [];
    }
  }

  static async getCategories(schoolId) {
    try {
      const [rows] = await pool.query(
        `SELECT id, category, status FROM student_category_master WHERE school_id = ? AND status = 1 ORDER BY sort_order ASC, id ASC`,
        [schoolId]
      );
      return rows || [];
    } catch (e) {
      console.error('Error in getCategories:', e.message);
      return [];
    }
  }

  static async getMotherTongues(schoolId) {
    try {
      const [rows] = await pool.query(
        `SELECT id, mother_tongue, status FROM mother_tongue_master WHERE school_id = ? AND status = 1 ORDER BY sort_order ASC, id ASC`,
        [schoolId]
      );
      return rows || [];
    } catch (e) {
      console.error('Error in getMotherTongues:', e.message);
      return [];
    }
  }

  static async getStudentMasters(schoolId, branchId = null) {
    const [
      academicYears,
      classes,
      sections,
      genders,
      bloodGroups,
      houses,
      religions,
      categories,
      motherTongues,
      countries,
      transportRoutes,
      hostels,
      documentTypes,
    ] = await Promise.all([
      AcademicModel.getAcademicYears(schoolId, branchId),
      AcademicModel.getClasses(schoolId, false, null, branchId),
      AcademicModel.getSections(schoolId, null, false, null, branchId),
      AcademicModel.getGenders(),
      AcademicModel.getBloodGroups(),
      AcademicModel.getHouses(schoolId, branchId),
      AcademicModel.getReligions(schoolId),
      AcademicModel.getCategories(schoolId),
      AcademicModel.getMotherTongues(schoolId),
      AcademicModel.getCountries(),
      AcademicModel.getTransportRoutes(schoolId, branchId),
      AcademicModel.getHostels(schoolId, branchId),
      AcademicModel.getDocumentTypes(schoolId, branchId),
    ]);

    return {
      academicYears,
      classes,
      sections,
      genders,
      bloodGroups,
      houses,
      religions,
      categories,
      motherTongues,
      countries,
      transportRoutes,
      hostels,
      documentTypes,
    };
  }

  static async getNextRollNumber(schoolId, classId, sectionId, branchId = null, academicYear = null) {
    try {
      const cleanClassId = AcademicModel.decodeIdValue(classId);
      const cleanSectionId = AcademicModel.decodeIdValue(sectionId);
      const cleanYearId = AcademicModel.decodeIdValue(academicYear);
      let sql = `SELECT MAX(CAST(roll_number AS UNSIGNED)) AS max_roll FROM student_master WHERE school_id = ? AND class = ? AND section = ? AND status NOT IN (0, 4)`;
      const params = [schoolId, cleanClassId, cleanSectionId];
      if (cleanYearId) {
        sql += ` AND academic_year = ?`;
        params.push(cleanYearId);
      } else {
        sql += ` AND status = 1`;
      }
      if (branchId && branchId !== 'all' && branchId !== '0') {
        sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        params.push(Number(branchId));
      }
      const [rows] = await pool.query(sql, params);
      const maxRoll = rows[0]?.max_roll || 0;
      return Number(maxRoll) + 1;
    } catch (e) {
      return 1;
    }
  }

  // ==================== DAYS ====================
  static async getDays(schoolId, branchId = null) {
    try {
      let sql = `
        SELECT d.*, bm.branch_name, bm.branch_code 
        FROM days_master d
        LEFT JOIN branch_master bm ON d.branch_id = bm.id
        WHERE d.school_id = ? AND (d.status != 4 OR d.status IS NULL)
      `;
      const params = [schoolId];
      if (branchId) {
        sql += ` AND (d.branch_id = ? OR d.branch_id IS NULL)`;
        params.push(Number(branchId));
      }
      sql += ` ORDER BY d.id ASC`;
      const [rows] = await pool.query(sql, params);
      return rows || [];
    } catch (e) {
      console.error('Error fetching days:', e.message);
      return [];
    }
  }

  static async getDayById(id, schoolId, branchId = null) {
    try {
      let sql = `SELECT d.*, bm.branch_name, bm.branch_code 
         FROM days_master d 
         LEFT JOIN branch_master bm ON d.branch_id = bm.id 
         WHERE d.id = ? AND d.school_id = ? AND (d.status != 4 OR d.status IS NULL)`;
      const params = [id, schoolId];
      if (branchId) {
        sql += ` AND (d.branch_id = ? OR d.branch_id IS NULL)`;
        params.push(Number(branchId));
      }
      sql += ` LIMIT 1`;
      const [rows] = await pool.query(sql, params);
      return rows[0] || null;
    } catch (e) {
      console.error('Error fetching day by id:', e.message);
      return null;
    }
  }

  static async createDay(schoolId, { day_name, branch_id = null, status = 1 }) {
    let resolvedBranchId = branch_id !== undefined && branch_id !== null && branch_id !== '' ? Number(branch_id) : null;
    if (!resolvedBranchId) {
      try {
        const [mainB] = await pool.query(
          `SELECT id FROM branch_master WHERE school_id = ? AND (is_main_branch = 1 OR id > 0) ORDER BY is_main_branch DESC LIMIT 1`,
          [schoolId]
        );
        if (mainB && mainB.length > 0) resolvedBranchId = mainB[0].id;
      } catch (e) {}
    }

    if (day_name && String(day_name).trim()) {
      let dupSql = `SELECT id FROM days_master WHERE school_id = ? AND LOWER(TRIM(day_name)) = LOWER(TRIM(?)) AND (status != 4 OR status IS NULL)`;
      const dupParams = [schoolId, String(day_name).trim()];
      if (resolvedBranchId) {
        dupSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        dupParams.push(resolvedBranchId);
      }
      dupSql += ` LIMIT 1`;
      const [existing] = await pool.query(dupSql, dupParams);
      if (existing && existing.length > 0) {
        const err = new Error(`A day named "${day_name}" already exists in this branch.`);
        err.statusCode = 400;
        throw err;
      }
    }

    const [result] = await pool.query(
      `INSERT INTO days_master (school_id, branch_id, day_name, status) VALUES (?, ?, ?, ?)`,
      [schoolId, resolvedBranchId, day_name, Number(status)]
    );
    return result.insertId;
  }

  static async updateDay(id, schoolId, { day_name, branch_id, status }, branchId = null) {
    const resolvedBranchId = branch_id !== undefined ? (branch_id !== null && branch_id !== '' ? Number(branch_id) : null) : (branchId ? Number(branchId) : null);

    if (day_name && String(day_name).trim()) {
      let dupSql = `SELECT id FROM days_master WHERE school_id = ? AND LOWER(TRIM(day_name)) = LOWER(TRIM(?)) AND id != ? AND (status != 4 OR status IS NULL)`;
      const dupParams = [schoolId, String(day_name).trim(), id];
      if (resolvedBranchId) {
        dupSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        dupParams.push(resolvedBranchId);
      }
      dupSql += ` LIMIT 1`;
      const [existing] = await pool.query(dupSql, dupParams);
      if (existing && existing.length > 0) {
        const err = new Error(`Another day named "${day_name}" already exists in this branch.`);
        err.statusCode = 400;
        throw err;
      }
    }

    const updates = [];
    const params = [];

    if (day_name !== undefined) {
      updates.push('day_name = ?');
      params.push(day_name);
    }
    if (branch_id !== undefined) {
      updates.push('branch_id = ?');
      params.push(branch_id !== null && branch_id !== '' ? Number(branch_id) : null);
    }
    if (status !== undefined) {
      updates.push('status = ?');
      params.push(Number(status));
    }

    if (updates.length === 0) return true;

    params.push(id, schoolId);
    let sql = `UPDATE days_master SET ${updates.join(', ')} WHERE id = ? AND school_id = ?`;
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  static async deleteDay(id, schoolId, branchId = null) {
    let sql = `UPDATE days_master SET status = 4 WHERE id = ? AND school_id = ?`;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  // ==================== DOCUMENT TYPES ====================
  static async createDocumentType(schoolId, { document_type_name, status = 1, branch_id = null }) {
    const resolvedBranchId = branch_id ? Number(branch_id) : null;

    if (document_type_name && String(document_type_name).trim()) {
      let dupSql = `SELECT id FROM document_type_master WHERE school_id = ? AND LOWER(TRIM(document_type_name)) = LOWER(TRIM(?)) AND (status != 4 OR status IS NULL)`;
      const dupParams = [schoolId, String(document_type_name).trim()];
      if (resolvedBranchId) {
        dupSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        dupParams.push(resolvedBranchId);
      }
      dupSql += ` LIMIT 1`;
      const [existing] = await pool.query(dupSql, dupParams);
      if (existing && existing.length > 0) {
        const err = new Error(`A document type named "${document_type_name}" already exists in this branch.`);
        err.statusCode = 400;
        throw err;
      }
    }

    const [result] = await pool.query(
      `INSERT INTO document_type_master (school_id, branch_id, document_type_name, status) VALUES (?, ?, ?, ?)`,
      [schoolId, resolvedBranchId, document_type_name, Number(status)]
    );
    return result.insertId;
  }

  static async updateDocumentType(id, schoolId, { document_type_name, status = 1, branch_id = null }, branchId = null) {
    const resolvedBranchId = branch_id ? Number(branch_id) : (branchId ? Number(branchId) : null);

    if (document_type_name && String(document_type_name).trim()) {
      let dupSql = `SELECT id FROM document_type_master WHERE school_id = ? AND LOWER(TRIM(document_type_name)) = LOWER(TRIM(?)) AND id != ? AND (status != 4 OR status IS NULL)`;
      const dupParams = [schoolId, String(document_type_name).trim(), id];
      if (resolvedBranchId) {
        dupSql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        dupParams.push(resolvedBranchId);
      }
      dupSql += ` LIMIT 1`;
      const [existing] = await pool.query(dupSql, dupParams);
      if (existing && existing.length > 0) {
        const err = new Error(`Another document type named "${document_type_name}" already exists in this branch.`);
        err.statusCode = 400;
        throw err;
      }
    }

    let sql = `UPDATE document_type_master SET document_type_name = ?, status = ? WHERE id = ? AND school_id = ?`;
    const params = [document_type_name, Number(status), id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  static async deleteDocumentType(id, schoolId, branchId = null) {
    let sql = `UPDATE document_type_master SET status = 4 WHERE id = ? AND school_id = ?`;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  // ==================== ROUTINES ====================
  static async getRoutines(schoolId, { classId, sectionId, day, teacherId, branchId = null } = {}) {
    try {
      let sql = `
        SELECT r.*, cm.class_name, sec.section_name, sm.subject_name, 
               CONCAT(TRIM(IFNULL(tm.first_name, '')), ' ', IFNULL(TRIM(tm.last_name), '')) AS teacher_name, 
               tm.picture AS teacher_picture,
               pm.period_name, pm.start_time, pm.end_time,
               shm.shift_name,
               dm.day_name
        FROM routine r
        LEFT JOIN class_master cm ON cm.id = r.class_id
        LEFT JOIN section_master sec ON sec.id = r.section_id
        LEFT JOIN subject_master sm ON sm.id = r.subject_id
        LEFT JOIN teacher_master tm ON tm.id = r.teacher_id
        LEFT JOIN period_master pm ON pm.id = r.period_id
        LEFT JOIN days_master dm ON dm.id = r.day
        LEFT JOIN shift_master shm ON shm.id = r.shift_id
        WHERE r.school_id = ?
        AND (r.status != 4 OR r.status IS NULL)
      `;
      const params = [schoolId];
      if (branchId) {
        sql += ` AND (r.branch_id = ? OR cm.branch_id = ?)`;
        params.push(Number(branchId), Number(branchId));
      }
      if (classId) {
        sql += ` AND r.class_id = ?`;
        params.push(classId);
      }
      if (sectionId) {
        sql += ` AND r.section_id = ?`;
        params.push(sectionId);
      }
      if (day) {
        sql += ` AND r.day = ?`;
        params.push(day);
      }
      if (teacherId) {
        sql += ` AND r.teacher_id = ?`;
        params.push(teacherId);
      }
      sql += ` ORDER BY r.day ASC, pm.start_time ASC, r.id ASC`;
      const [rows] = await pool.query(sql, params);
      return rows;
    } catch (e) {
      console.error('Error in getRoutines:', e.message);
      return [];
    }
  }

  static async checkRoutineConflicts(schoolId, { routineId = null, class_id, section_id, day, period_id, teacher_id }) {
    // 1. Check if this Class and Section already has a scheduled routine for this day and period
    if (class_id && section_id && day && period_id) {
      let slotSql = `
        SELECT r.id, sm.subject_name, pm.period_name
        FROM routine r
        LEFT JOIN subject_master sm ON sm.id = r.subject_id
        LEFT JOIN period_master pm ON pm.id = r.period_id
        WHERE r.school_id = ?
          AND r.class_id = ?
          AND r.section_id = ?
          AND r.day = ?
          AND r.period_id = ?
          AND (r.status != 4 OR r.status IS NULL)
      `;
      const slotParams = [schoolId, class_id, section_id, day, period_id];
      if (routineId) {
        slotSql += ` AND r.id != ?`;
        slotParams.push(routineId);
      }
      slotSql += ` LIMIT 1`;
      const [existingSlots] = await pool.query(slotSql, slotParams);
      if (existingSlots.length > 0) {
        const slot = existingSlots[0];
        const subName = slot.subject_name ? `"${slot.subject_name}"` : 'a subject';
        const perName = slot.period_name ? ` (${slot.period_name})` : '';
        const err = new Error(`Conflict: This class and section already has ${subName} scheduled for this period${perName}.`);
        err.statusCode = 409;
        err.status = 409;
        throw err;
      }
    }

    // 2. Check if the teacher is already assigned to another class/section with overlapping time on the same day
    if (teacher_id && day && period_id) {
      const [targetPerRows] = await pool.query(
        `SELECT start_time, end_time, period_name FROM period_master WHERE id = ?`,
        [period_id]
      );
      const targetPer = targetPerRows[0] || null;
      const targetStart = targetPer?.start_time || null;
      const targetEnd = targetPer?.end_time || null;

      let teacherSql = `
        SELECT 
          r.id,
          cm.class_name,
          sec.section_name,
          sm.subject_name,
          pm.period_name,
          TIME_FORMAT(pm.start_time, '%H:%i') AS start_time,
          TIME_FORMAT(pm.end_time, '%H:%i') AS end_time,
          CONCAT(TRIM(IFNULL(tm.first_name, '')), ' ', IFNULL(TRIM(tm.last_name), '')) AS teacher_name
        FROM routine r
        JOIN period_master pm ON pm.id = r.period_id
        LEFT JOIN class_master cm ON cm.id = r.class_id
        LEFT JOIN section_master sec ON sec.id = r.section_id
        LEFT JOIN subject_master sm ON sm.id = r.subject_id
        LEFT JOIN teacher_master tm ON tm.id = r.teacher_id
        WHERE r.school_id = ?
          AND r.day = ?
          AND r.teacher_id = ?
          AND (r.status != 4 OR r.status IS NULL)
      `;
      const teacherParams = [schoolId, day, teacher_id];

      if (targetStart && targetEnd) {
        teacherSql += ` AND (
          (pm.start_time IS NOT NULL AND pm.end_time IS NOT NULL AND ? < pm.end_time AND ? > pm.start_time)
          OR r.period_id = ?
        )`;
        teacherParams.push(targetStart, targetEnd, period_id);
      } else {
        teacherSql += ` AND r.period_id = ?`;
        teacherParams.push(period_id);
      }

      if (routineId) {
        teacherSql += ` AND r.id != ?`;
        teacherParams.push(routineId);
      }
      teacherSql += ` LIMIT 1`;

      const [conflicts] = await pool.query(teacherSql, teacherParams);
      if (conflicts.length > 0) {
        const c = conflicts[0];
        const teacherName = c.teacher_name?.trim() || 'This teacher';
        const className = c.class_name || 'another class';
        const sectionName = c.section_name ? ` - Section ${c.section_name}` : '';
        const timeRange = (c.start_time && c.end_time) ? ` (${c.start_time} - ${c.end_time})` : '';
        const periodName = c.period_name ? ` during ${c.period_name}` : '';
        const err = new Error(
          `Conflict: Teacher ${teacherName} is already scheduled in ${className}${sectionName}${periodName}${timeRange}.`
        );
        err.statusCode = 409;
        err.status = 409;
        throw err;
      }
    }
  }

  static async createRoutine(schoolId, { branch_id = null, class_id, section_id, day, period_id, teacher_id, subject_id, shift_id }) {
    await AcademicModel.checkRoutineConflicts(schoolId, {
      class_id,
      section_id,
      day,
      period_id,
      teacher_id,
    });

    let resolvedBranchId = branch_id;
    if (!resolvedBranchId && class_id) {
      const [cm] = await pool.query(`SELECT branch_id FROM class_master WHERE id = ?`, [class_id]);
      if (cm.length && cm[0].branch_id) resolvedBranchId = cm[0].branch_id;
    }
    if (!resolvedBranchId) {
      const [mb] = await pool.query(`SELECT id FROM branch_master WHERE school_id = ? AND (is_main_branch = 1 OR id > 0) ORDER BY is_main_branch DESC LIMIT 1`, [schoolId]);
      if (mb.length) resolvedBranchId = mb[0].id;
    }

    let finalShiftId = shift_id;
    if (!finalShiftId && period_id) {
      const [perRows] = await pool.query(`SELECT shift_id FROM period_master WHERE id = ?`, [period_id]);
      if (perRows.length > 0 && perRows[0].shift_id) {
        finalShiftId = perRows[0].shift_id;
      }
    }
    if (!finalShiftId && class_id) {
      const [clsRows] = await pool.query(`SELECT shift_id FROM class_master WHERE id = ?`, [class_id]);
      if (clsRows.length > 0 && clsRows[0].shift_id) {
        finalShiftId = clsRows[0].shift_id;
      }
    }
    const [result] = await pool.query(
      `INSERT INTO routine (school_id, branch_id, class_id, section_id, day, period_id, teacher_id, subject_id, shift_id, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())`,
      [schoolId, resolvedBranchId, class_id, section_id, day, period_id, teacher_id || null, subject_id, finalShiftId || null]
    );
    return result.insertId;
  }

  static async updateRoutine(id, schoolId, { class_id, section_id, day, period_id, teacher_id, subject_id, shift_id }) {
    const [existing] = await pool.query(`SELECT * FROM routine WHERE id = ? AND school_id = ?`, [id, schoolId]);
    if (existing.length === 0) return false;
    const current = existing[0];

    const finalClassId = class_id !== undefined ? class_id : current.class_id;
    const finalSectionId = section_id !== undefined ? section_id : current.section_id;
    const finalDay = day !== undefined ? day : current.day;
    const finalPeriodId = period_id !== undefined ? period_id : current.period_id;
    const finalTeacherId = teacher_id !== undefined ? teacher_id : current.teacher_id;
    const finalSubjectId = subject_id !== undefined ? subject_id : current.subject_id;

    await AcademicModel.checkRoutineConflicts(schoolId, {
      routineId: id,
      class_id: finalClassId,
      section_id: finalSectionId,
      day: finalDay,
      period_id: finalPeriodId,
      teacher_id: finalTeacherId,
    });

    let finalShiftId = shift_id;
    if (!finalShiftId && finalPeriodId) {
      const [perRows] = await pool.query(`SELECT shift_id FROM period_master WHERE id = ?`, [finalPeriodId]);
      if (perRows.length > 0 && perRows[0].shift_id) {
        finalShiftId = perRows[0].shift_id;
      }
    }
    const [result] = await pool.query(
      `UPDATE routine SET class_id = ?, section_id = ?, day = ?, period_id = ?, teacher_id = ?, subject_id = ?, shift_id = ?, updated_at = NOW()
       WHERE id = ? AND school_id = ?`,
      [finalClassId, finalSectionId, finalDay, finalPeriodId, finalTeacherId || null, finalSubjectId, finalShiftId || null, id, schoolId]
    );
    return result.affectedRows > 0;
  }

  static async deleteRoutine(id, schoolId, branchId = null) {
    let sql = `UPDATE routine SET status = 4 WHERE id = ? AND school_id = ?`;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND branch_id = ?`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  // ==================== CLASS ASSIGNED TEACHERS (teacher_class_assign & teacher_master) ====================
  static async getClassAssignedTeachers(schoolId, { classId, subjectId, branchId = null } = {}) {
    try {
      let sql = `
        SELECT * FROM (
          SELECT DISTINCT 
            tm.id, 
            tm.first_name, 
            tm.last_name, 
            CONCAT(TRIM(tm.first_name), ' ', IFNULL(TRIM(tm.last_name), '')) AS full_name,
            tm.teacher_id AS teacher_code,
            tm.picture,
            tca.class_id, 
            tca.subject_id,
            sm.subject_name
          FROM teacher_class_assign tca
          JOIN teacher_master tm ON tca.teacher_id = tm.id
          LEFT JOIN subject_master sm ON sm.id = tca.subject_id
          WHERE tca.school_id = ?
            AND tca.status = 1 
            AND tm.status = 1
            AND (? IS NULL OR tca.class_id = ?)
            ${branchId ? 'AND tm.branch_id = ?' : ''}

          UNION

          SELECT DISTINCT
            tm.id, 
            tm.first_name, 
            tm.last_name, 
            CONCAT(TRIM(tm.first_name), ' ', IFNULL(TRIM(tm.last_name), '')) AS full_name,
            tm.teacher_id AS teacher_code,
            tm.picture,
            tm.class AS class_id, 
            tm.subject AS subject_id,
            sm.subject_name
          FROM teacher_master tm
          LEFT JOIN subject_master sm ON sm.id = tm.subject
          WHERE tm.school_id = ?
            AND tm.status = 1
            AND (? IS NULL OR tm.class = ?)
            ${branchId ? 'AND tm.branch_id = ?' : ''}
        ) AS combined
        WHERE 1=1
      `;
      const params = [
        schoolId, classId || null, classId || null,
        ...(branchId ? [Number(branchId)] : []),
        schoolId, classId || null, classId || null,
        ...(branchId ? [Number(branchId)] : []),
      ];

      if (subjectId) {
        sql += ` AND (
          subject_id = ? 
          OR LOWER(subject_name) = (SELECT LOWER(subject_name) FROM subject_master WHERE id = ? LIMIT 1)
        )`;
        params.push(subjectId, subjectId);
      }

      sql += ` ORDER BY first_name ASC, last_name ASC`;
      const [rows] = await pool.query(sql, params);
      return rows;
    } catch (e) {
      console.error('Error in getClassAssignedTeachers:', e.message);
      return [];
    }
  }

  // ==================== LESSONS / SYLLABUS ====================
  static async getSyllabusList(schoolId, { academic_year, academic_year_id, class_id, classId, subject_id, subjectId, status, search, page = 1, limit = 10, branchId = null } = {}) {
    try {
      let baseSql = `
        FROM syllabus s
        LEFT JOIN class_master cm ON cm.id = s.class_id
        LEFT JOIN subject_master sm ON sm.id = s.subject_id
        LEFT JOIN academic_year_master aym ON aym.id = s.academic_year
        WHERE s.school_id = ?
          AND (s.status != 4 OR s.status IS NULL)
      `;
      const params = [schoolId];

      if (branchId) {
        baseSql += ` AND (s.branch_id = ? OR cm.branch_id = ?)`;
        params.push(Number(branchId), Number(branchId));
      }

      const effectiveYear = academic_year || academic_year_id;
      if (effectiveYear) {
        baseSql += ` AND s.academic_year = ?`;
        params.push(effectiveYear);
      }

      const effectiveClass = class_id || classId;
      if (effectiveClass) {
        baseSql += ` AND s.class_id = ?`;
        params.push(effectiveClass);
      }

      const effectiveSubject = subject_id || subjectId;
      if (effectiveSubject) {
        baseSql += ` AND s.subject_id = ?`;
        params.push(effectiveSubject);
      }

      if (status !== undefined && status !== null && String(status).trim() !== '' && String(status).trim() !== '0' && String(status).toLowerCase() !== 'all') {
        baseSql += ` AND s.status = ?`;
        params.push(Number(status));
      }

      if (search && String(search).trim()) {
        baseSql += ` AND (s.lession LIKE ? OR sm.subject_name LIKE ? OR cm.class_name LIKE ?)`;
        const searchParam = `%${String(search).trim()}%`;
        params.push(searchParam, searchParam, searchParam);
      }

      // 1. Total Count Query
      const countSql = `SELECT COUNT(*) AS total ${baseSql}`;
      const [countRows] = await pool.query(countSql, params);
      const total = countRows[0]?.total || 0;

      // 2. Data Query with LIMIT & OFFSET
      const numLimit = Math.max(1, Number(limit) || 10);
      const numPage = Math.max(1, Number(page) || 1);
      const offset = (numPage - 1) * numLimit;

      const dataSql = `
        SELECT s.*, 
          cm.class_name, 
          sm.subject_name,
          aym.academic_year AS academic_year_code,
          CONCAT(DATE_FORMAT(aym.start_date, '%M %Y'), ' - ', DATE_FORMAT(aym.end_date, '%M %Y')) AS academic_year_name
        ${baseSql}
        ORDER BY s.id ASC
        LIMIT ? OFFSET ?
      `;
      const dataParams = [...params, numLimit, offset];
      const [rows] = await pool.query(dataSql, dataParams);

      const totalPages = Math.ceil(total / numLimit) || 1;

      return {
        syllabus: rows,
        total,
        page: numPage,
        limit: numLimit,
        totalPages,
      };
    } catch (e) {
      console.error('Error in getSyllabusList:', e.message);
      return { syllabus: [], total: 0, page: 1, limit: 10, totalPages: 1 };
    }
  }

  static async getSyllabusById(id, schoolId, branchId = null) {
    try {
      let sql = `SELECT s.*, 
          cm.class_name, 
          sm.subject_name,
          aym.academic_year AS academic_year_code,
          CONCAT(DATE_FORMAT(aym.start_date, '%M %Y'), ' - ', DATE_FORMAT(aym.end_date, '%M %Y')) AS academic_year_name
        FROM syllabus s
        LEFT JOIN class_master cm ON cm.id = s.class_id
        LEFT JOIN subject_master sm ON sm.id = s.subject_id
        LEFT JOIN academic_year_master aym ON aym.id = s.academic_year
        WHERE s.id = ? 
          AND s.school_id = ?
          AND (s.status != 4 OR s.status IS NULL)`;
      const params = [id, schoolId];
      if (branchId) {
        sql += ` AND (s.branch_id = ? OR s.branch_id IS NULL)`;
        params.push(Number(branchId));
      }
      sql += ` LIMIT 1`;
      const [rows] = await pool.query(sql, params);
      return rows[0] || null;
    } catch (e) {
      console.error('Error in getSyllabusById:', e.message);
      return null;
    }
  }

  static async createSyllabus(schoolId, { branch_id = null, academic_year, class_id, subject_id, lession, status = 1 }) {
    let resolvedBranchId = branch_id;
    if (!resolvedBranchId && class_id) {
      const [cm] = await pool.query(`SELECT branch_id FROM class_master WHERE id = ?`, [class_id]);
      if (cm.length && cm[0].branch_id) resolvedBranchId = cm[0].branch_id;
    }
    if (!resolvedBranchId) {
      const [mb] = await pool.query(`SELECT id FROM branch_master WHERE school_id = ? AND (is_main_branch = 1 OR id > 0) ORDER BY is_main_branch DESC LIMIT 1`, [schoolId]);
      if (mb.length) resolvedBranchId = mb[0].id;
    }

    const [result] = await pool.query(
      `INSERT INTO syllabus (school_id, branch_id, academic_year, class_id, subject_id, lession, status, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, NOW())`,
      [schoolId, resolvedBranchId, academic_year, class_id, subject_id, lession, status || 1]
    );
    return result.insertId;
  }

  static async updateSyllabus(id, schoolId, { academic_year, class_id, subject_id, lession, status, branch_id = null }, branchId = null) {
    let sql = `UPDATE syllabus 
       SET academic_year = COALESCE(?, academic_year),
           class_id = COALESCE(?, class_id),
           subject_id = COALESCE(?, subject_id),
           lession = ?,
           status = ?
       WHERE id = ? AND school_id = ?`;
    const params = [academic_year || null, class_id || null, subject_id || null, lession, status, id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  static async updateSyllabusStatus(id, schoolId, status, branchId = null) {
    let sql = `UPDATE syllabus SET status = ? WHERE id = ? AND school_id = ?`;
    const params = [Number(status), id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  static async deleteSyllabus(id, schoolId, branchId = null) {
    let sql = `UPDATE syllabus SET status = 4 WHERE id = ? AND school_id = ?`;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND branch_id = ?`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  static async getLessons(schoolId, { classId, subjectId, branchId = null } = {}) {
    try {
      let sql = `
        SELECT lm.*, cm.class_name, sm.subject_name
        FROM lession_master lm
        LEFT JOIN class_master cm ON cm.id = lm.class_id
        LEFT JOIN subject_master sm ON sm.id = lm.subject_id
        WHERE lm.school_id = ? AND (lm.status != 4 OR lm.status IS NULL)
      `;
      const params = [schoolId];
      if (branchId) {
        sql += ` AND (cm.branch_id = ? OR cm.branch_id IS NULL)`;
        params.push(Number(branchId));
      }
      if (classId) {
        sql += ` AND lm.class_id = ?`;
        params.push(classId);
      }
      if (subjectId) {
        sql += ` AND lm.subject_id = ?`;
        params.push(subjectId);
      }
      sql += ` ORDER BY lm.id DESC`;
      const [rows] = await pool.query(sql, params);
      return rows;
    } catch (e) {
      return [];
    }
  }

  static async createLesson(schoolId, { class_id, subject_id, lession_name, lession_description, branch_id = null }) {
    const [result] = await pool.query(
      `INSERT INTO lession_master (school_id, branch_id, class_id, subject_id, lession_name, lession_description, status)
       VALUES (?, ?, ?, ?, ?, ?, 1)`,
      [schoolId, branch_id ? Number(branch_id) : null, class_id, subject_id, lession_name, lession_description || '']
    );
    return result.insertId;
  }

  static async deleteLesson(id, schoolId, branchId = null) {
    let sql = `UPDATE lession_master SET status = 4 WHERE id = ? AND school_id = ?`;
    const params = [id, schoolId];
    if (branchId) {
      sql += ` AND (branch_id = ? OR branch_id IS NULL)`;
      params.push(Number(branchId));
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  // ==================== ASSIGNMENTS ====================
  static async getAssignmentTypes(schoolId, options = {}) {
    try {
      const normalizedOpts =
        typeof options === 'boolean'
          ? { status: options ? 1 : undefined, limit: 100 }
          : options || {};
      const { search, status, page = 1, limit = 10, branchId = null, branch_id = null } = normalizedOpts;
      const cleanBranchId = AcademicModel.parseBranchId(branchId ?? branch_id);

      let baseSql = `
        FROM assignment_types at
        LEFT JOIN branch_master bm ON at.branch_id = bm.id
        WHERE at.school_id = ?
      `;
      const params = [schoolId];

      if (cleanBranchId) {
        baseSql += ` AND at.branch_id = ?`;
        params.push(cleanBranchId);
      }

      if (status !== undefined && status !== null && String(status).trim() !== '') {
        baseSql += ` AND at.status = ?`;
        params.push(Number(status));
      } else {
        baseSql += ` AND (at.status != 4 OR at.status IS NULL)`;
      }

      if (search && String(search).trim()) {
        baseSql += ` AND at.type_name LIKE ?`;
        params.push(`%${String(search).trim()}%`);
      }

      // 1. Count query
      const countSql = `SELECT COUNT(*) AS total ${baseSql}`;
      const [countRows] = await pool.query(countSql, params);
      const total = countRows[0]?.total || 0;

      // 2. Data query
      const numLimit = Math.max(1, Number(limit) || 10);
      const numPage = Math.max(1, Number(page) || 1);
      const offset = (numPage - 1) * numLimit;

      const dataSql = `
        SELECT at.*, bm.branch_name, bm.branch_code ${baseSql}
        ORDER BY at.id ASC
        LIMIT ? OFFSET ?
      `;
      const dataParams = [...params, numLimit, offset];
      const [rows] = await pool.query(dataSql, dataParams);

      const totalPages = Math.ceil(total / numLimit) || 1;

      return {
        assignment_types: rows || [],
        total,
        page: numPage,
        limit: numLimit,
        totalPages,
      };
    } catch (e) {
      console.error('Error in getAssignmentTypes:', e.message);
      return {
        assignment_types: [],
        total: 0,
        page: 1,
        limit: 10,
        totalPages: 1,
      };
    }
  }

  static async getAssignmentTypeById(id, schoolId, branchId = null) {
    try {
      const cleanBranchId = AcademicModel.parseBranchId(branchId);
      let sql = `SELECT at.*, bm.branch_name, bm.branch_code
        FROM assignment_types at
        LEFT JOIN branch_master bm ON at.branch_id = bm.id
        WHERE at.id = ? AND at.school_id = ? AND (at.status != 4 OR at.status IS NULL)`;
      const params = [id, schoolId];
      if (cleanBranchId) {
        sql += ` AND at.branch_id = ?`;
        params.push(cleanBranchId);
      }
      sql += ` LIMIT 1`;
      const [rows] = await pool.query(sql, params);
      return rows[0] || null;
    } catch (e) {
      console.error('Error in getAssignmentTypeById:', e.message);
      return null;
    }
  }

  static async createAssignmentType(schoolId, { type_name, status = 1, branch_id = null, branchId = null }) {
    const cleanName = String(type_name || '').trim();
    if (!cleanName) {
      const err = new Error('Assignment type name is required.');
      err.statusCode = 400;
      throw err;
    }

    const resolvedBranchId = await AcademicModel.resolveDefaultBranchId(schoolId, branch_id ?? branchId);

    let dupSql = `SELECT id FROM assignment_types WHERE school_id = ? AND LOWER(TRIM(type_name)) = LOWER(TRIM(?)) AND (status != 4 OR status IS NULL)`;
    const dupParams = [schoolId, cleanName];
    if (resolvedBranchId) {
      dupSql += ` AND branch_id = ?`;
      dupParams.push(resolvedBranchId);
    } else {
      dupSql += ` AND branch_id IS NULL`;
    }
    dupSql += ` LIMIT 1`;
    const [existing] = await pool.query(dupSql, dupParams);
    if (existing && existing.length > 0) {
      const err = new Error(`An assignment type named "${cleanName}" already exists in this branch.`);
      err.statusCode = 400;
      throw err;
    }

    const [result] = await pool.query(
      `INSERT INTO assignment_types (school_id, branch_id, type_name, status, created_on) VALUES (?, ?, ?, ?, NOW())`,
      [schoolId, resolvedBranchId, cleanName, status || 1]
    );
    return result.insertId;
  }

  static async updateAssignmentType(id, schoolId, { type_name, status, branch_id = null }, branchId = null) {
    const filterBranch = AcademicModel.parseBranchId(branchId);

    let checkSql = `SELECT id, branch_id, type_name FROM assignment_types WHERE id = ? AND school_id = ? AND (status != 4 OR status IS NULL)`;
    const checkParams = [id, schoolId];
    if (filterBranch) {
      checkSql += ` AND branch_id = ?`;
      checkParams.push(filterBranch);
    }
    checkSql += ` LIMIT 1`;
    const [existingRows] = await pool.query(checkSql, checkParams);
    if (!existingRows || existingRows.length === 0) {
      return false;
    }

    const targetBranchId = AcademicModel.parseBranchId(branch_id) || filterBranch || AcademicModel.parseBranchId(existingRows[0].branch_id);

    if (type_name && String(type_name).trim()) {
      const cleanName = String(type_name).trim();
      let dupSql = `SELECT id FROM assignment_types WHERE school_id = ? AND LOWER(TRIM(type_name)) = LOWER(TRIM(?)) AND id != ? AND (status != 4 OR status IS NULL)`;
      const dupParams = [schoolId, cleanName, id];
      if (targetBranchId) {
        dupSql += ` AND branch_id = ?`;
        dupParams.push(targetBranchId);
      } else {
        dupSql += ` AND branch_id IS NULL`;
      }
      dupSql += ` LIMIT 1`;
      const [existing] = await pool.query(dupSql, dupParams);
      if (existing && existing.length > 0) {
        const err = new Error(`Another assignment type named "${cleanName}" already exists in this branch.`);
        err.statusCode = 400;
        throw err;
      }
    }

    let sql = `UPDATE assignment_types 
       SET type_name = COALESCE(?, type_name),
           status = COALESCE(?, status)
       WHERE id = ? AND school_id = ?`;
    const params = [type_name ? String(type_name).trim() : null, status !== undefined ? status : null, id, schoolId];
    if (filterBranch) {
      sql += ` AND branch_id = ?`;
      params.push(filterBranch);
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  static async deleteAssignmentType(id, schoolId, branchId = null) {
    const cleanBranchId = AcademicModel.parseBranchId(branchId);
    let sql = `UPDATE assignment_types SET status = 4 WHERE id = ? AND school_id = ? AND (status != 4 OR status IS NULL)`;
    const params = [id, schoolId];
    if (cleanBranchId) {
      sql += ` AND branch_id = ?`;
      params.push(cleanBranchId);
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  /**
   * Validates that class_id, section_id, subject_id, and assignment_type_id
   * belong to the specified school_id and branch_id (and teacher assignments if teacherId is provided),
   * and enforces branch-scoped duplicate validation on assignments.
   */
  static async validateAssignmentRelations(schoolId, branchId, data, teacherId = null, excludeAssignmentId = null) {
    const cleanBranchId = AcademicModel.parseBranchId(branchId);
    const {
      assignment_type_id,
      title,
      class_id,
      section_id,
      subject_id,
    } = data;

    if (!title || !String(title).trim()) {
      const err = new Error('Assignment title is required.');
      err.statusCode = 400;
      throw err;
    }
    if (!class_id) {
      const err = new Error('Class is required.');
      err.statusCode = 400;
      throw err;
    }
    if (!subject_id) {
      const err = new Error('Subject is required.');
      err.statusCode = 400;
      throw err;
    }

    // 1. Validate Class belongs to school and branch
    let clsSql = `SELECT id, branch_id, class_name FROM class_master WHERE id = ? AND school_id = ? AND (status != 4 OR status IS NULL)`;
    const clsParams = [class_id, schoolId];
    if (cleanBranchId) {
      clsSql += ` AND branch_id = ?`;
      clsParams.push(cleanBranchId);
    }
    clsSql += ` LIMIT 1`;
    const [clsRows] = await pool.query(clsSql, clsParams);
    if (!clsRows || clsRows.length === 0) {
      const err = new Error('Selected class does not belong to the authorized school and branch.');
      err.statusCode = 400;
      throw err;
    }

    const effectiveBranchId = cleanBranchId || AcademicModel.parseBranchId(clsRows[0].branch_id);

    // If teacherId is provided, verify teacher belongs to this school/branch and is assigned to this class
    if (teacherId) {
      let tSql = `SELECT id, branch_id, class, subject FROM teacher_master WHERE id = ? AND school_id = ? AND status != 4`;
      const tParams = [teacherId, schoolId];
      if (effectiveBranchId) {
        tSql += ` AND branch_id = ?`;
        tParams.push(effectiveBranchId);
      }
      tSql += ` LIMIT 1`;
      const [tRows] = await pool.query(tSql, tParams);
      if (!tRows || tRows.length === 0) {
        const err = new Error('Teacher does not belong to the authorized school and branch.');
        err.statusCode = 403;
        throw err;
      }

      const [tcaCountRows] = await pool.query(
        `SELECT COUNT(*) AS cnt FROM teacher_class_assign WHERE teacher_id = ? AND school_id = ? AND status = 1`,
        [teacherId, schoolId]
      );
      const hasClassAssignments = (tcaCountRows?.[0]?.cnt || 0) > 0;
      if (hasClassAssignments) {
        const [assignedCls] = await pool.query(
          `SELECT id FROM teacher_class_assign WHERE teacher_id = ? AND school_id = ? AND class_id = ? AND status = 1 LIMIT 1`,
          [teacherId, schoolId, class_id]
        );
        const isPrimaryClass = Number(tRows[0].class) === Number(class_id);
        if ((!assignedCls || assignedCls.length === 0) && !isPrimaryClass) {
          const err = new Error('You are not assigned to the selected class in your branch.');
          err.statusCode = 403;
          throw err;
        }
      }
    }

    // 2. Validate Section (if provided) belongs to school, branch, and class
    if (section_id !== undefined && section_id !== null && String(section_id).trim() !== '' && Number(section_id) > 0) {
      let secSql = `SELECT sec.id FROM section_master sec
        LEFT JOIN class_master cm ON sec.class_id = cm.id
        WHERE sec.id = ? AND sec.school_id = ? AND sec.class_id = ? AND (sec.status != 4 OR sec.status IS NULL)`;
      const secParams = [section_id, schoolId, class_id];
      if (effectiveBranchId) {
        secSql += ` AND COALESCE(sec.branch_id, cm.branch_id) = ?`;
        secParams.push(effectiveBranchId);
      }
      secSql += ` LIMIT 1`;
      const [secRows] = await pool.query(secSql, secParams);
      if (!secRows || secRows.length === 0) {
        const err = new Error('Selected section does not belong to the selected class and branch.');
        err.statusCode = 400;
        throw err;
      }
    }

    // 3. Validate Subject belongs to school, branch, and class
    let subSql = `SELECT sm.id FROM subject_master sm
      LEFT JOIN class_master cm ON sm.class_id = cm.id
      WHERE sm.id = ? AND sm.school_id = ? AND (sm.class_id = ? OR sm.class_id IS NULL) AND (sm.status != 4 OR sm.status IS NULL)`;
    const subParams = [subject_id, schoolId, class_id];
    if (effectiveBranchId) {
      subSql += ` AND COALESCE(sm.branch_id, cm.branch_id) = ?`;
      subParams.push(effectiveBranchId);
    }
    subSql += ` LIMIT 1`;
    const [subRows] = await pool.query(subSql, subParams);
    if (!subRows || subRows.length === 0) {
      const err = new Error('Selected subject does not belong to the selected class and branch.');
      err.statusCode = 400;
      throw err;
    }

    // If teacherId is provided and teacher has subject assignments for this class, verify subject assignment
    if (teacherId) {
      const [tcaSubCount] = await pool.query(
        `SELECT COUNT(*) AS cnt FROM teacher_class_assign WHERE teacher_id = ? AND school_id = ? AND class_id = ? AND subject_id > 0 AND status = 1`,
        [teacherId, schoolId, class_id]
      );
      if ((tcaSubCount?.[0]?.cnt || 0) > 0) {
        const [assignedSub] = await pool.query(
          `SELECT id FROM teacher_class_assign WHERE teacher_id = ? AND school_id = ? AND class_id = ? AND subject_id = ? AND status = 1 LIMIT 1`,
          [teacherId, schoolId, class_id, subject_id]
        );
        if (!assignedSub || assignedSub.length === 0) {
          const err = new Error('You are not assigned to teach the selected subject for this class.');
          err.statusCode = 403;
          throw err;
        }
      }
    }

    // 4. Validate Assignment Type (if provided) belongs to school and branch
    if (assignment_type_id !== undefined && assignment_type_id !== null && String(assignment_type_id).trim() !== '' && Number(assignment_type_id) > 0) {
      let atSql = `SELECT id FROM assignment_types WHERE id = ? AND school_id = ? AND (status != 4 OR status IS NULL)`;
      const atParams = [assignment_type_id, schoolId];
      if (effectiveBranchId) {
        atSql += ` AND branch_id = ?`;
        atParams.push(effectiveBranchId);
      }
      atSql += ` LIMIT 1`;
      const [atRows] = await pool.query(atSql, atParams);
      if (!atRows || atRows.length === 0) {
        const err = new Error('Selected assignment type does not belong to the authorized school and branch.');
        err.statusCode = 400;
        throw err;
      }
    }

    // 5. Branch-scoped duplicate check (same title + class + section + subject within the same school and branch)
    let dupSql = `SELECT id FROM assignments
      WHERE school_id = ?
        AND class_id = ?
        AND subject_id = ?
        AND COALESCE(section_id, 0) = COALESCE(?, 0)
        AND LOWER(TRIM(title)) = LOWER(TRIM(?))
        AND (status != 4 OR status IS NULL)`;
    const dupParams = [
      schoolId,
      class_id,
      subject_id,
      section_id && Number(section_id) > 0 ? Number(section_id) : 0,
      String(title).trim(),
    ];
    if (effectiveBranchId) {
      dupSql += ` AND branch_id = ?`;
      dupParams.push(effectiveBranchId);
    } else {
      dupSql += ` AND branch_id IS NULL`;
    }
    if (excludeAssignmentId) {
      dupSql += ` AND id != ?`;
      dupParams.push(excludeAssignmentId);
    }
    dupSql += ` LIMIT 1`;
    const [dupRows] = await pool.query(dupSql, dupParams);
    if (dupRows && dupRows.length > 0) {
      const err = new Error(`An assignment titled "${String(title).trim()}" already exists for this class, section, and subject in this branch.`);
      err.statusCode = 400;
      throw err;
    }

    return effectiveBranchId;
  }

  static validateAndPrepareQuestions(questions, configuredTotalMarks = null) {
    if (!Array.isArray(questions) || questions.length === 0) {
      const err = new Error('Assignment must include at least one question.');
      err.statusCode = 400;
      throw err;
    }

    const seenNormalized = new Map();
    const preparedQuestions = [];
    let calculatedTotalMarks = 0;

    for (let idx = 0; idx < questions.length; idx++) {
      const q = questions[idx] || {};
      const qNum = idx + 1;
      const qText = String(q.question || q.title || '').trim();
      if (!qText) {
        const err = new Error(`Question #${qNum} statement cannot be empty.`);
        err.statusCode = 400;
        throw err;
      }

      const normQ = qText.toLowerCase().replace(/\s+/g, ' ');
      if (seenNormalized.has(normQ)) {
        const err = new Error(
          `Duplicate question detected: Question #${qNum} is identical to Question #${seenNormalized.get(normQ)}.`
        );
        err.statusCode = 400;
        throw err;
      }
      seenNormalized.set(normQ, qNum);

      const rawType = q.question_type || 'MCQ';
      const qType = AcademicModel.normalizeQuestionType(rawType);
      if (!qType) {
        const err = new Error(
          `Question #${qNum} has an invalid question type "${rawType}". Allowed: MCQ, True / False, Short Answer, Long Answer.`
        );
        err.statusCode = 400;
        throw err;
      }

      const rawMarks = q.marks !== undefined && q.marks !== null && String(q.marks).trim() !== '' ? Number(q.marks) : 1;
      if (isNaN(rawMarks) || rawMarks <= 0) {
        const err = new Error(`Question #${qNum} marks must be a positive number greater than 0.`);
        err.statusCode = 400;
        throw err;
      }
      const cleanMarks = Number(rawMarks.toFixed(2));
      calculatedTotalMarks = Number((calculatedTotalMarks + cleanMarks).toFixed(2));

      const instructions = q.instructions ? String(q.instructions).trim() : null;
      let preparedAnswers = [];
      let correctAnswerText = q.correct_answer_text ? String(q.correct_answer_text).trim() : null;

      if (qType === 'MCQ') {
        const rawAnswers = Array.isArray(q.answers)
          ? q.answers
          : Array.isArray(q.options)
          ? q.options
          : [];
        const nonEmptyAnswers = rawAnswers
          .map((ans, oIdx) => {
            const ansText = typeof ans === 'string' ? ans.trim() : String(ans?.answer ?? ans?.text ?? '').trim();
            const isCorr =
              (typeof ans === 'object' && Number(ans?.is_correct) === 1) || Number(q.correct_answer) === oIdx ? 1 : 0;
            return { answer: ansText, is_correct: isCorr };
          })
          .filter((a) => a.answer !== '');

        if (nonEmptyAnswers.length < 2) {
          const err = new Error(`Question #${qNum} (MCQ) must have at least 2 valid options.`);
          err.statusCode = 400;
          throw err;
        }

        if (!nonEmptyAnswers.some((a) => a.is_correct === 1)) {
          nonEmptyAnswers[0].is_correct = 1;
        }
        const corrOpt = nonEmptyAnswers.find((a) => a.is_correct === 1);
        correctAnswerText = corrOpt ? corrOpt.answer : null;
        preparedAnswers = nonEmptyAnswers;
      } else if (qType === 'TRUE_FALSE') {
        const rawAnswers = Array.isArray(q.answers)
          ? q.answers
          : Array.isArray(q.options)
          ? q.options
          : [];
        const opt0Text =
          rawAnswers[0] && String(rawAnswers[0]?.answer ?? rawAnswers[0]?.text ?? rawAnswers[0] ?? '').trim()
            ? String(rawAnswers[0]?.answer ?? rawAnswers[0]?.text ?? rawAnswers[0]).trim()
            : 'True';
        const opt1Text =
          rawAnswers[1] && String(rawAnswers[1]?.answer ?? rawAnswers[1]?.text ?? rawAnswers[1] ?? '').trim()
            ? String(rawAnswers[1]?.answer ?? rawAnswers[1]?.text ?? rawAnswers[1]).trim()
            : 'False';

        let corrIdx = 0;
        if (
          (typeof rawAnswers[1] === 'object' && Number(rawAnswers[1]?.is_correct) === 1) ||
          Number(q.correct_answer) === 1 ||
          String(q.correct_answer_text || '').trim().toLowerCase() === 'false'
        ) {
          corrIdx = 1;
        }
        preparedAnswers = [
          { answer: opt0Text, is_correct: corrIdx === 0 ? 1 : 0 },
          { answer: opt1Text, is_correct: corrIdx === 1 ? 1 : 0 },
        ];
        correctAnswerText = corrIdx === 0 ? opt0Text : opt1Text;
      } else {
        // SHORT_ANSWER or LONG_ANSWER
        preparedAnswers = [];
      }

      preparedQuestions.push({
        question: qText,
        question_type: qType,
        marks: cleanMarks,
        instructions,
        correct_answer_text: correctAnswerText,
        answers: preparedAnswers,
      });
    }

    if (
      configuredTotalMarks !== undefined &&
      configuredTotalMarks !== null &&
      String(configuredTotalMarks).trim() !== ''
    ) {
      const targetTotal = Number(Number(configuredTotalMarks).toFixed(2));
      if (isNaN(targetTotal) || targetTotal <= 0) {
        const err = new Error('Configured Total Marks must be a positive number.');
        err.statusCode = 400;
        throw err;
      }
      if (Math.abs(targetTotal - calculatedTotalMarks) > 0.01) {
        const err = new Error(
          `Total question marks (${calculatedTotalMarks}) do not match the assignment's configured total marks (${targetTotal}).`
        );
        err.statusCode = 400;
        throw err;
      }
    }

    return {
      preparedQuestions,
      calculatedTotalMarks,
    };
  }

  static async getAssignments(schoolId, { classId, class_id, sectionId, section_id, subjectId, subject_id, assignmentTypeId, assignment_type_id, search, status, page, limit, branchId = null, branch_id = null, teacherId = null } = {}) {
    try {
      await AcademicModel.ensureAssignmentSchema();
      const cId = classId || class_id;
      const sId = sectionId || section_id;
      const subId = subjectId || subject_id;
      const atId = assignmentTypeId || assignment_type_id;
      const cleanBranchId = AcademicModel.parseBranchId(branchId ?? branch_id);

      let baseSql = `
        FROM assignments a
        LEFT JOIN assignment_types at ON at.id = a.assignment_type_id
        LEFT JOIN class_master cm ON cm.id = a.class_id
        LEFT JOIN section_master sec ON sec.id = a.section_id
        LEFT JOIN subject_master sm ON sm.id = a.subject_id
        WHERE a.school_id = ?
          AND (a.status != 4 OR a.status IS NULL)
      `;
      const params = [schoolId];

      if (cleanBranchId) {
        baseSql += ` AND COALESCE(a.branch_id, cm.branch_id) = ?`;
        params.push(cleanBranchId);
      }

      if (teacherId) {
        baseSql += ` AND (
          EXISTS (
            SELECT 1 FROM teacher_class_assign tca
            WHERE tca.teacher_id = ? AND tca.school_id = a.school_id AND tca.class_id = a.class_id AND tca.status = 1
          )
          OR EXISTS (
            SELECT 1 FROM teacher_master tm
            WHERE tm.id = ? AND tm.school_id = a.school_id AND tm.class = a.class_id AND tm.status != 4
          )
        )`;
        params.push(Number(teacherId), Number(teacherId));
      }

      if (cId) {
        baseSql += ` AND a.class_id = ?`;
        params.push(cId);
      }
      if (sId) {
        baseSql += ` AND a.section_id = ?`;
        params.push(sId);
      }
      if (subId) {
        baseSql += ` AND a.subject_id = ?`;
        params.push(subId);
      }
      if (atId) {
        baseSql += ` AND a.assignment_type_id = ?`;
        params.push(atId);
      }
      if (status !== undefined && status !== '') {
        baseSql += ` AND a.status = ?`;
        params.push(status);
      }
      if (search && String(search).trim()) {
        baseSql += ` AND (a.title LIKE ? OR at.type_name LIKE ?)`;
        params.push(`%${String(search).trim()}%`, `%${String(search).trim()}%`);
      }

      const selectFields = `
        a.*, at.type_name, cm.class_name, sec.section_name, sm.subject_name,
        (SELECT COUNT(*) FROM assignment_questions aq WHERE aq.assignment_id = a.id AND aq.school_id = a.school_id AND (aq.status != 4 OR aq.status IS NULL)) AS question_count,
        COALESCE(a.total_marks, (SELECT ROUND(SUM(COALESCE(aq.marks, 1)), 2) FROM assignment_questions aq WHERE aq.assignment_id = a.id AND aq.school_id = a.school_id AND (aq.status != 4 OR aq.status IS NULL))) AS total_marks,
        (SELECT COUNT(DISTINCT saa.student_id) FROM student_assignment_attempts saa WHERE saa.assignment_id = a.id AND saa.status = 1) AS submitted_count,
        (SELECT COUNT(*) FROM student_master st WHERE st.school_id = a.school_id AND st.class = a.class_id AND (a.section_id IS NULL OR a.section_id = 0 OR st.section = a.section_id) AND (a.branch_id IS NULL OR st.branch_id = a.branch_id OR st.branch_id IS NULL) AND st.status != 4) AS total_students,
        (SELECT ROUND(AVG(saa.score_percentage), 2) FROM student_assignment_attempts saa WHERE saa.assignment_id = a.id AND saa.status = 1) AS avg_score_percentage
      `;

      // If pagination requested
      if (page && limit) {
        const countSql = `SELECT COUNT(*) AS total ${baseSql}`;
        const [countRows] = await pool.query(countSql, params);
        const total = countRows[0]?.total || 0;

        const numLimit = Math.max(1, Number(limit) || 10);
        const numPage = Math.max(1, Number(page) || 1);
        const offset = (numPage - 1) * numLimit;

        const dataSql = `
          SELECT ${selectFields}
          ${baseSql}
          ORDER BY a.id DESC
          LIMIT ? OFFSET ?
        `;
        const dataParams = [...params, numLimit, offset];
        const [rows] = await pool.query(dataSql, dataParams);
        const totalPages = Math.ceil(total / numLimit) || 1;

        return {
          assignments: rows,
          total,
          page: numPage,
          limit: numLimit,
          totalPages,
        };
      }

      const sql = `
        SELECT ${selectFields}
        ${baseSql}
        ORDER BY a.id DESC
      `;
      const [rows] = await pool.query(sql, params);
      return rows;
    } catch (e) {
      console.error('Error in getAssignments:', e.message);
      return [];
    }
  }

  static async getAssignmentById(id, schoolId, branchId = null, teacherId = null) {
    try {
      await AcademicModel.ensureAssignmentSchema();
      const cleanBranchId = AcademicModel.parseBranchId(branchId);
      let sql = `SELECT a.*, at.type_name, cm.class_name, sec.section_name, sm.subject_name,
                (SELECT COUNT(*) FROM assignment_questions aq WHERE aq.assignment_id = a.id AND aq.school_id = a.school_id AND (aq.status != 4 OR aq.status IS NULL)) AS question_count,
                COALESCE(a.total_marks, (SELECT ROUND(SUM(COALESCE(aq.marks, 1)), 2) FROM assignment_questions aq WHERE aq.assignment_id = a.id AND aq.school_id = a.school_id AND (aq.status != 4 OR aq.status IS NULL))) AS total_marks,
                (SELECT COUNT(DISTINCT saa.student_id) FROM student_assignment_attempts saa WHERE saa.assignment_id = a.id AND saa.status = 1) AS submitted_count,
                (SELECT COUNT(*) FROM student_master st WHERE st.school_id = a.school_id AND st.class = a.class_id AND (a.section_id IS NULL OR a.section_id = 0 OR st.section = a.section_id) AND (a.branch_id IS NULL OR st.branch_id = a.branch_id OR st.branch_id IS NULL) AND st.status != 4) AS total_students,
                (SELECT ROUND(AVG(saa.score_percentage), 2) FROM student_assignment_attempts saa WHERE saa.assignment_id = a.id AND saa.status = 1) AS avg_score_percentage
         FROM assignments a
         LEFT JOIN assignment_types at ON at.id = a.assignment_type_id
         LEFT JOIN class_master cm ON cm.id = a.class_id
         LEFT JOIN section_master sec ON sec.id = a.section_id
         LEFT JOIN subject_master sm ON sm.id = a.subject_id
         WHERE a.id = ? AND a.school_id = ? AND (a.status != 4 OR a.status IS NULL)`;
      const params = [id, schoolId];
      if (cleanBranchId) {
        sql += ` AND COALESCE(a.branch_id, cm.branch_id) = ?`;
        params.push(cleanBranchId);
      }
      if (teacherId) {
        sql += ` AND (
          EXISTS (
            SELECT 1 FROM teacher_class_assign tca
            WHERE tca.teacher_id = ? AND tca.school_id = a.school_id AND tca.class_id = a.class_id AND tca.status = 1
          )
          OR EXISTS (
            SELECT 1 FROM teacher_master tm
            WHERE tm.id = ? AND tm.school_id = a.school_id AND tm.class = a.class_id AND tm.status != 4
          )
        )`;
        params.push(Number(teacherId), Number(teacherId));
      }
      sql += ` LIMIT 1`;
      const [rows] = await pool.query(sql, params);
      return rows[0] || null;
    } catch (e) {
      console.error('Error in getAssignmentById:', e.message);
      return null;
    }
  }

  static async getAssignmentQuestions(assignmentId, schoolId, branchId = null) {
    try {
      await AcademicModel.ensureAssignmentSchema();
      const cleanBranchId = AcademicModel.parseBranchId(branchId);

      // Verify parent assignment belongs to school and branch
      let asgSql = `SELECT a.id, COALESCE(a.branch_id, cm.branch_id) AS branch_id
        FROM assignments a
        LEFT JOIN class_master cm ON cm.id = a.class_id
        WHERE a.id = ? AND a.school_id = ? AND (a.status != 4 OR a.status IS NULL)`;
      const asgParams = [assignmentId, schoolId];
      if (cleanBranchId) {
        asgSql += ` AND COALESCE(a.branch_id, cm.branch_id) = ?`;
        asgParams.push(cleanBranchId);
      }
      asgSql += ` LIMIT 1`;
      const [asgRows] = await pool.query(asgSql, asgParams);
      if (!asgRows || asgRows.length === 0) {
        return [];
      }

      let sql = `SELECT * FROM assignment_questions 
         WHERE assignment_id = ? AND school_id = ? AND (status != 4 OR status IS NULL)`;
      const params = [assignmentId, schoolId];
      if (cleanBranchId) {
        sql += ` AND branch_id = ?`;
        params.push(cleanBranchId);
      }
      sql += ` ORDER BY id ASC`;
      const [questions] = await pool.query(sql, params);

      if (questions.length === 0) return [];

      const questionIds = questions.map((q) => q.id);
      let ansSql = `SELECT * FROM assignment_answers 
         WHERE question_id IN (?) AND school_id = ? AND (status != 4 OR status IS NULL)`;
      const ansParams = [questionIds, schoolId];
      if (cleanBranchId) {
        ansSql += ` AND branch_id = ?`;
        ansParams.push(cleanBranchId);
      }
      ansSql += ` ORDER BY id ASC`;
      const [answers] = await pool.query(ansSql, ansParams);

      return questions.map((q) => ({
        ...q,
        question_type: AcademicModel.normalizeQuestionType(q.question_type) || 'MCQ',
        question_type_label: AcademicModel.getQuestionTypeLabel(q.question_type),
        marks: q.marks != null ? Number(q.marks) : 1,
        answers: answers.filter((ans) => ans.question_id === q.id),
      }));
    } catch (e) {
      console.error('Error in getAssignmentQuestions:', e.message);
      return [];
    }
  }

  static async publishAssignment(id, schoolId, branchId = null) {
    await AcademicModel.ensureAssignmentSchema();
    const cleanBranchId = AcademicModel.parseBranchId(branchId);

    const existing = await AcademicModel.getAssignmentById(id, schoolId, cleanBranchId);
    if (!existing) return false;

    const questions = await AcademicModel.getAssignmentQuestions(id, schoolId, cleanBranchId);
    if (!questions || questions.length === 0) {
      const err = new Error('Cannot publish assignment without any questions.');
      err.statusCode = 400;
      throw err;
    }

    const sumMarks = Number(questions.reduce((acc, q) => acc + (Number(q.marks) || 1), 0).toFixed(2));
    if (existing.total_marks != null && Number(existing.total_marks) > 0) {
      if (Math.abs(Number(existing.total_marks) - sumMarks) > 0.01) {
        const err = new Error(
          `Cannot publish: Total question marks (${sumMarks}) must match the assignment's configured total marks (${Number(existing.total_marks)}).`
        );
        err.statusCode = 400;
        throw err;
      }
    }

    let sql = `UPDATE assignments SET is_published = 1, total_marks = COALESCE(total_marks, ?) WHERE id = ? AND school_id = ? AND (status != 4 OR status IS NULL)`;
    const params = [sumMarks, id, schoolId];
    if (cleanBranchId) {
      sql += ` AND branch_id = ?`;
      params.push(cleanBranchId);
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  static async createAssignment(schoolId, data, branchId = null, teacherId = null) {
    await AcademicModel.ensureAssignmentSchema();
    const {
      branch_id = null,
      assignment_type_id,
      title,
      class_id,
      section_id,
      subject_id,
      assigned_date,
      start_date,
      start_time = null,
      due_date,
      end_date,
      end_time = null,
      duration_minutes = null,
      total_marks = null,
      passing_marks = null,
      max_attempts = 1,
      instructions = null,
      is_published = 0,
      questions = [],
    } = data || {};

    const effectiveStartDate = assigned_date || start_date || new Date().toISOString().split('T')[0];
    const effectiveEndDate = due_date || end_date;
    if (!effectiveEndDate) {
      const err = new Error('End Date (Due Date) is required.');
      err.statusCode = 400;
      throw err;
    }

    const startDt = AcademicModel.combineDateAndTime(effectiveStartDate, start_time, false);
    const endDt = AcademicModel.combineDateAndTime(effectiveEndDate, end_time, true);
    if (startDt && endDt && endDt.getTime() <= startDt.getTime()) {
      const err = new Error('End Date & Time must be after Start Date & Time.');
      err.statusCode = 400;
      throw err;
    }

    let cleanDuration = null;
    if (duration_minutes !== undefined && duration_minutes !== null && String(duration_minutes).trim() !== '') {
      cleanDuration = parseInt(duration_minutes, 10);
      if (isNaN(cleanDuration) || cleanDuration <= 0) {
        const err = new Error('Total Duration (in minutes) must be a positive whole number.');
        err.statusCode = 400;
        throw err;
      }
    }

    let cleanMaxAttempts = 1;
    if (max_attempts !== undefined && max_attempts !== null && String(max_attempts).trim() !== '') {
      cleanMaxAttempts = parseInt(max_attempts, 10);
      if (isNaN(cleanMaxAttempts) || cleanMaxAttempts < 1) {
        const err = new Error('Number of Attempts Allowed must be at least 1.');
        err.statusCode = 400;
        throw err;
      }
    }

    const { preparedQuestions, calculatedTotalMarks } = AcademicModel.validateAndPrepareQuestions(
      questions,
      total_marks
    );

    const effectiveTotalMarks =
      total_marks !== undefined && total_marks !== null && String(total_marks).trim() !== ''
        ? Number(Number(total_marks).toFixed(2))
        : calculatedTotalMarks;

    let cleanPassingMarks = null;
    if (passing_marks !== undefined && passing_marks !== null && String(passing_marks).trim() !== '') {
      cleanPassingMarks = Number(Number(passing_marks).toFixed(2));
      if (isNaN(cleanPassingMarks) || cleanPassingMarks < 0) {
        const err = new Error('Passing Marks cannot be negative.');
        err.statusCode = 400;
        throw err;
      }
      if (cleanPassingMarks > effectiveTotalMarks) {
        const err = new Error(
          `Passing Marks (${cleanPassingMarks}) cannot exceed Total Marks (${effectiveTotalMarks}).`
        );
        err.statusCode = 400;
        throw err;
      }
    }

    const requestedBranchId = AcademicModel.parseBranchId(branch_id ?? branchId);
    const validatedBranchId = await AcademicModel.validateAssignmentRelations(
      schoolId,
      requestedBranchId,
      { assignment_type_id, title, class_id, section_id, subject_id },
      teacherId,
      null
    );
    const resolvedBranchId = await AcademicModel.resolveDefaultBranchId(schoolId, validatedBranchId || requestedBranchId);

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      const [result] = await connection.query(
        `INSERT INTO assignments (
           school_id, branch_id, assignment_type_id, title, class_id, section_id, subject_id,
           assigned_date, start_time, due_date, end_time, duration_minutes,
           total_marks, passing_marks, max_attempts, instructions,
           status, is_published, created_on
         )
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, NOW())`,
        [
          schoolId,
          resolvedBranchId,
          assignment_type_id || null,
          String(title).trim(),
          class_id,
          section_id || null,
          subject_id,
          effectiveStartDate,
          start_time ? String(start_time).trim() : null,
          effectiveEndDate,
          end_time ? String(end_time).trim() : null,
          cleanDuration,
          effectiveTotalMarks,
          cleanPassingMarks,
          cleanMaxAttempts,
          instructions ? String(instructions).trim() : null,
          Number(is_published) === 1 ? 1 : 0,
        ]
      );
      const assignmentId = result.insertId;

      for (const q of preparedQuestions) {
        const [qResult] = await connection.query(
          `INSERT INTO assignment_questions (
             school_id, branch_id, assignment_id, question, question_type, marks, instructions, correct_answer_text, status, created_at
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())`,
          [
            schoolId,
            resolvedBranchId,
            assignmentId,
            q.question,
            q.question_type,
            q.marks,
            q.instructions,
            q.correct_answer_text,
          ]
        );
        const questionId = qResult.insertId;

        for (const ans of q.answers) {
          await connection.query(
            `INSERT INTO assignment_answers (school_id, branch_id, question_id, answer, is_correct, status, created_at)
             VALUES (?, ?, ?, ?, ?, 1, NOW())`,
            [schoolId, resolvedBranchId, questionId, ans.answer, ans.is_correct]
          );
        }
      }

      await connection.commit();
      return assignmentId;
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  static async updateAssignment(id, schoolId, data, branchId = null, teacherId = null) {
    await AcademicModel.ensureAssignmentSchema();
    const {
      assignment_type_id,
      title,
      class_id,
      section_id,
      subject_id,
      assigned_date,
      start_date,
      start_time,
      due_date,
      end_date,
      end_time,
      duration_minutes,
      total_marks,
      passing_marks,
      max_attempts,
      instructions,
      is_published,
      questions,
    } = data || {};
    const filterBranch = AcademicModel.parseBranchId(branchId);

    // 1. Verify existing assignment belongs to school and branch
    let checkSql = `SELECT a.*, COALESCE(a.branch_id, cm.branch_id) AS resolved_branch_id
      FROM assignments a
      LEFT JOIN class_master cm ON cm.id = a.class_id
      WHERE a.id = ? AND a.school_id = ? AND (a.status != 4 OR a.status IS NULL)`;
    const checkParams = [id, schoolId];
    if (filterBranch) {
      checkSql += ` AND COALESCE(a.branch_id, cm.branch_id) = ?`;
      checkParams.push(filterBranch);
    }
    checkSql += ` LIMIT 1`;
    const [existingRows] = await pool.query(checkSql, checkParams);
    if (!existingRows || existingRows.length === 0) {
      return false;
    }
    const existing = existingRows[0];
    if (Number(existing.is_published) === 1) {
      const err = new Error('Published assignments are locked and cannot be edited.');
      err.statusCode = 400;
      throw err;
    }

    const targetBranchId = filterBranch || AcademicModel.parseBranchId(existing.resolved_branch_id);

    const effectiveStartDate = assigned_date || start_date || existing.assigned_date;
    const effectiveEndDate = due_date || end_date || existing.due_date;
    const effectiveStartTime = start_time !== undefined ? (start_time ? String(start_time).trim() : null) : existing.start_time;
    const effectiveEndTime = end_time !== undefined ? (end_time ? String(end_time).trim() : null) : existing.end_time;

    const startDt = AcademicModel.combineDateAndTime(effectiveStartDate, effectiveStartTime, false);
    const endDt = AcademicModel.combineDateAndTime(effectiveEndDate, effectiveEndTime, true);
    if (startDt && endDt && endDt.getTime() <= startDt.getTime()) {
      const err = new Error('End Date & Time must be after Start Date & Time.');
      err.statusCode = 400;
      throw err;
    }

    let cleanDuration = existing.duration_minutes;
    if (duration_minutes !== undefined) {
      if (duration_minutes === null || String(duration_minutes).trim() === '') {
        cleanDuration = null;
      } else {
        cleanDuration = parseInt(duration_minutes, 10);
        if (isNaN(cleanDuration) || cleanDuration <= 0) {
          const err = new Error('Total Duration (in minutes) must be a positive whole number.');
          err.statusCode = 400;
          throw err;
        }
      }
    }

    let cleanMaxAttempts = existing.max_attempts || 1;
    if (max_attempts !== undefined && max_attempts !== null && String(max_attempts).trim() !== '') {
      cleanMaxAttempts = parseInt(max_attempts, 10);
      if (isNaN(cleanMaxAttempts) || cleanMaxAttempts < 1) {
        const err = new Error('Number of Attempts Allowed must be at least 1.');
        err.statusCode = 400;
        throw err;
      }
    }

    let preparedQuestions = null;
    let effectiveTotalMarks =
      total_marks !== undefined && total_marks !== null && String(total_marks).trim() !== ''
        ? Number(Number(total_marks).toFixed(2))
        : existing.total_marks != null
        ? Number(existing.total_marks)
        : null;

    if (Array.isArray(questions)) {
      const validated = AcademicModel.validateAndPrepareQuestions(questions, total_marks);
      preparedQuestions = validated.preparedQuestions;
      effectiveTotalMarks =
        total_marks !== undefined && total_marks !== null && String(total_marks).trim() !== ''
          ? Number(Number(total_marks).toFixed(2))
          : validated.calculatedTotalMarks;
    }

    let cleanPassingMarks = existing.passing_marks;
    if (passing_marks !== undefined) {
      if (passing_marks === null || String(passing_marks).trim() === '') {
        cleanPassingMarks = null;
      } else {
        cleanPassingMarks = Number(Number(passing_marks).toFixed(2));
        if (isNaN(cleanPassingMarks) || cleanPassingMarks < 0) {
          const err = new Error('Passing Marks cannot be negative.');
          err.statusCode = 400;
          throw err;
        }
        if (effectiveTotalMarks != null && cleanPassingMarks > effectiveTotalMarks) {
          const err = new Error(
            `Passing Marks (${cleanPassingMarks}) cannot exceed Total Marks (${effectiveTotalMarks}).`
          );
          err.statusCode = 400;
          throw err;
        }
      }
    }

    // 2. Validate relations and branch-scoped duplicate check
    const mergedData = {
      assignment_type_id: assignment_type_id !== undefined ? assignment_type_id : existing.assignment_type_id,
      title: title !== undefined ? title : existing.title,
      class_id: class_id !== undefined ? class_id : existing.class_id,
      section_id: section_id !== undefined ? section_id : existing.section_id,
      subject_id: subject_id !== undefined ? subject_id : existing.subject_id,
    };
    const validatedBranchId = await AcademicModel.validateAssignmentRelations(
      schoolId,
      targetBranchId,
      mergedData,
      teacherId,
      id
    );
    const resolvedBranchId = validatedBranchId || targetBranchId;

    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      let sql = `UPDATE assignments 
         SET assignment_type_id = COALESCE(?, assignment_type_id),
             title = COALESCE(?, title),
             class_id = COALESCE(?, class_id),
             section_id = COALESCE(?, section_id),
             subject_id = COALESCE(?, subject_id),
             assigned_date = COALESCE(?, assigned_date),
             start_time = ?,
             due_date = COALESCE(?, due_date),
             end_time = ?,
             duration_minutes = ?,
             total_marks = ?,
             passing_marks = ?,
             max_attempts = ?,
             instructions = ?,
             is_published = COALESCE(?, is_published),
             branch_id = COALESCE(?, branch_id)
         WHERE id = ? AND school_id = ?`;
      const params = [
        assignment_type_id || null,
        title ? String(title).trim() : null,
        class_id || null,
        section_id || null,
        subject_id || null,
        effectiveStartDate || null,
        effectiveStartTime,
        effectiveEndDate || null,
        effectiveEndTime,
        cleanDuration,
        effectiveTotalMarks,
        cleanPassingMarks,
        cleanMaxAttempts,
        instructions !== undefined ? (instructions ? String(instructions).trim() : null) : existing.instructions,
        is_published !== undefined ? is_published : null,
        resolvedBranchId || null,
        id,
        schoolId,
      ];
      if (filterBranch) {
        sql += ` AND branch_id = ?`;
        params.push(filterBranch);
      }
      const [updateResult] = await connection.query(sql, params);
      if (updateResult.affectedRows === 0) {
        await connection.rollback();
        return false;
      }

      if (Array.isArray(preparedQuestions)) {
        // Soft delete old questions and answers scoped to school and branch
        let oldQSql = `SELECT id FROM assignment_questions WHERE assignment_id = ? AND school_id = ?`;
        const oldQParams = [id, schoolId];
        if (resolvedBranchId) {
          oldQSql += ` AND branch_id = ?`;
          oldQParams.push(resolvedBranchId);
        }
        const [oldQuestions] = await connection.query(oldQSql, oldQParams);
        if (oldQuestions.length > 0) {
          const oldQIds = oldQuestions.map((q) => q.id);
          await connection.query(
            `UPDATE assignment_answers SET status = 4 WHERE question_id IN (?) AND school_id = ?`,
            [oldQIds, schoolId]
          );
          await connection.query(
            `UPDATE assignment_questions SET status = 4 WHERE id IN (?) AND school_id = ?`,
            [oldQIds, schoolId]
          );
        }

        for (const q of preparedQuestions) {
          const [qResult] = await connection.query(
            `INSERT INTO assignment_questions (
               school_id, branch_id, assignment_id, question, question_type, marks, instructions, correct_answer_text, status, created_at
             )
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, NOW())`,
            [
              schoolId,
              resolvedBranchId,
              id,
              q.question,
              q.question_type,
              q.marks,
              q.instructions,
              q.correct_answer_text,
            ]
          );
          const questionId = qResult.insertId;

          for (const ans of q.answers) {
            await connection.query(
              `INSERT INTO assignment_answers (school_id, branch_id, question_id, answer, is_correct, status, created_at)
               VALUES (?, ?, ?, ?, ?, 1, NOW())`,
              [schoolId, resolvedBranchId, questionId, ans.answer, ans.is_correct]
            );
          }
        }
      }

      await connection.commit();
      return true;
    } catch (err) {
      await connection.rollback();
      throw err;
    } finally {
      connection.release();
    }
  }

  static async deleteAssignment(id, schoolId, branchId = null) {
    const cleanBranchId = AcademicModel.parseBranchId(branchId);
    let sql = `UPDATE assignments SET status = 4 WHERE id = ? AND school_id = ? AND (status != 4 OR status IS NULL)`;
    const params = [id, schoolId];
    if (cleanBranchId) {
      sql += ` AND branch_id = ?`;
      params.push(cleanBranchId);
    }
    const [result] = await pool.query(sql, params);
    if (result.affectedRows > 0) {
      // Also soft-delete child questions and answers scoped to school and branch
      const [qRows] = await pool.query(
        `SELECT id FROM assignment_questions WHERE assignment_id = ? AND school_id = ?`,
        [id, schoolId]
      );
      if (qRows.length > 0) {
        const qIds = qRows.map((q) => q.id);
        await pool.query(`UPDATE assignment_answers SET status = 4 WHERE question_id IN (?) AND school_id = ?`, [qIds, schoolId]);
        await pool.query(`UPDATE assignment_questions SET status = 4 WHERE id IN (?) AND school_id = ?`, [qIds, schoolId]);
      }
    }
    return result.affectedRows > 0;
  }

  static isAssignmentDeadlineExpired(dueDate, endTime = null) {
    if (!dueDate) return false;
    const endDt = AcademicModel.combineDateAndTime(dueDate, endTime, true);
    if (!endDt) return false;
    return Date.now() > endDt.getTime();
  }

  static async getAssignmentSubmissions(assignmentId, schoolId, { branchId = null, teacherId = null } = {}) {
    try {
      await AcademicModel.ensureAssignmentSchema();
      const cleanBranchId = AcademicModel.parseBranchId(branchId);
      const assignment = await AcademicModel.getAssignmentById(assignmentId, schoolId, cleanBranchId, teacherId);
      if (!assignment) return null;

      if (teacherId) {
        const [tcaSubRows] = await pool.query(
          `SELECT subject_id FROM teacher_class_assign WHERE teacher_id = ? AND school_id = ? AND class_id = ? AND status = 1`,
          [teacherId, schoolId, assignment.class_id]
        );
        const [tmRows] = await pool.query(
          `SELECT class, subject FROM teacher_master WHERE id = ? AND school_id = ? AND status != 4 LIMIT 1`,
          [teacherId, schoolId]
        );
        const isPrimaryClassTeacher = Number(tmRows?.[0]?.class) === Number(assignment.class_id);
        const hasUnrestrictedClassRow = (tcaSubRows || []).some((r) => !r.subject_id || Number(r.subject_id) === 0);
        const assignedSubjectIds = (tcaSubRows || [])
          .map((r) => Number(r.subject_id))
          .filter((id) => id > 0);
        if (tmRows?.[0]?.subject && Number(tmRows[0].subject) > 0) {
          assignedSubjectIds.push(Number(tmRows[0].subject));
        }

        if (
          assignedSubjectIds.length > 0 &&
          !hasUnrestrictedClassRow &&
          !isPrimaryClassTeacher &&
          assignment.subject_id &&
          !assignedSubjectIds.includes(Number(assignment.subject_id))
        ) {
          return null;
        }
      }

      const effectiveBranchId = cleanBranchId || AcademicModel.parseBranchId(assignment.branch_id);
      const sectionFilter = assignment.section_id && Number(assignment.section_id) > 0 ? Number(assignment.section_id) : null;

      const [studentRows] = await pool.query(
        `SELECT
           s.id AS student_id,
           s.admission_number,
           s.roll_number,
           s.first_name,
           s.last_name,
           CONCAT(TRIM(IFNULL(s.first_name, '')), ' ', TRIM(IFNULL(s.last_name, ''))) AS student_name,
           s.picture,
           s.email_address,
           s.primary_contact_number,
           s.class AS class_id,
           cm.class_name,
           s.section AS section_id,
           sec.section_name,
           att.id AS attempt_id,
           att.attempt_number,
           att.total_questions AS attempt_total_questions,
           att.correct_answers,
           att.obtained_marks,
           att.total_marks AS attempt_total_marks,
           att.is_passed,
           att.score_percentage,
           att.attempted_at
         FROM student_master s
         LEFT JOIN class_master cm ON cm.id = s.class
         LEFT JOIN section_master sec ON sec.id = s.section
         LEFT JOIN student_assignment_attempts att
           ON att.id = (
             SELECT saa.id FROM student_assignment_attempts saa
             WHERE saa.assignment_id = ? AND saa.student_id = s.id AND saa.status = 1
             ORDER BY saa.id DESC LIMIT 1
           )
         WHERE s.school_id = ?
           AND s.status != 4
           AND (
             (
               s.class = ?
               AND (? IS NULL OR s.section = ?)
               AND (? IS NULL OR s.branch_id = ? OR s.branch_id IS NULL)
             )
             OR att.id IS NOT NULL
           )
         ORDER BY
           CASE WHEN att.id IS NOT NULL THEN 0 ELSE 1 END ASC,
           att.score_percentage DESC,
           CAST(s.roll_number AS UNSIGNED) ASC,
           s.first_name ASC`,
        [
          assignment.id,
          schoolId,
          assignment.class_id,
          sectionFilter,
          sectionFilter,
          effectiveBranchId,
          effectiveBranchId,
        ]
      );

      const isExpired = AcademicModel.isAssignmentDeadlineExpired(assignment.due_date, assignment.end_time);
      const totalQuestionsCount = Number(assignment.question_count) || 0;

      let submittedCount = 0;
      let pendingCount = 0;
      let missedCount = 0;
      const scores = [];

      const students = (studentRows || []).map((row) => {
        const isSubmitted = row.attempt_id != null;
        let submissionStatus = 'Pending';
        if (isSubmitted) {
          submissionStatus = 'Submitted';
          submittedCount++;
          if (row.score_percentage != null) {
            scores.push(Number(row.score_percentage));
          }
        } else if (isExpired) {
          submissionStatus = 'Missed';
          missedCount++;
        } else {
          submissionStatus = 'Pending';
          pendingCount++;
        }

        return {
          student_id: row.student_id,
          admission_number: row.admission_number,
          roll_number: row.roll_number,
          first_name: row.first_name,
          last_name: row.last_name,
          student_name: row.student_name,
          picture: row.picture,
          email_address: row.email_address,
          primary_contact_number: row.primary_contact_number,
          class_id: row.class_id,
          class_name: row.class_name,
          section_id: row.section_id,
          section_name: row.section_name,
          attempt_id: row.attempt_id || null,
          attempt_number: row.attempt_number ? Number(row.attempt_number) : null,
          is_submitted: isSubmitted,
          submission_status: submissionStatus,
          status: isSubmitted ? 'Attempted' : isExpired ? 'Expired' : 'Pending',
          total_questions: isSubmitted ? Number(row.attempt_total_questions || totalQuestionsCount) : totalQuestionsCount,
          correct_answers: isSubmitted ? Number(row.correct_answers || 0) : null,
          obtained_marks: isSubmitted && row.obtained_marks != null ? Number(row.obtained_marks) : null,
          total_marks:
            isSubmitted && row.attempt_total_marks != null
              ? Number(row.attempt_total_marks)
              : assignment.total_marks != null
              ? Number(assignment.total_marks)
              : null,
          is_passed: isSubmitted && row.is_passed != null ? Number(row.is_passed) === 1 : null,
          score_percentage: isSubmitted && row.score_percentage != null ? Number(row.score_percentage) : null,
          attempted_at: row.attempted_at || null,
        };
      });

      const totalStudents = students.length;
      const completionRate = totalStudents > 0 ? Number(((submittedCount / totalStudents) * 100).toFixed(2)) : 0;
      const averageScore =
        scores.length > 0
          ? Number((scores.reduce((acc, val) => acc + val, 0) / scores.length).toFixed(2))
          : null;
      const highestScore = scores.length > 0 ? Number(Math.max(...scores).toFixed(2)) : null;
      const lowestScore = scores.length > 0 ? Number(Math.min(...scores).toFixed(2)) : null;

      return {
        assignment: {
          ...assignment,
          is_expired: isExpired,
        },
        summary: {
          total_students: totalStudents,
          submitted_count: submittedCount,
          pending_count: pendingCount,
          missed_count: missedCount,
          completion_rate: completionRate,
          average_score: averageScore,
          highest_score: highestScore,
          lowest_score: lowestScore,
        },
        students,
      };
    } catch (e) {
      console.error('Error in getAssignmentSubmissions:', e.message);
      throw e;
    }
  }

  static async getStudentAssignmentSubmissionDetail(assignmentId, studentId, schoolId, { branchId = null, teacherId = null } = {}) {
    try {
      await AcademicModel.ensureAssignmentSchema();
      const cleanBranchId = AcademicModel.parseBranchId(branchId);
      const assignment = await AcademicModel.getAssignmentById(assignmentId, schoolId, cleanBranchId, teacherId);
      if (!assignment) return null;

      const [stuRows] = await pool.query(
        `SELECT
           s.id,
           s.admission_number,
           s.roll_number,
           s.first_name,
           s.last_name,
           CONCAT(TRIM(IFNULL(s.first_name, '')), ' ', TRIM(IFNULL(s.last_name, ''))) AS full_name,
           s.picture,
           s.class AS class_id,
           cm.class_name,
           s.section AS section_id,
           sec.section_name
         FROM student_master s
         LEFT JOIN class_master cm ON cm.id = s.class
         LEFT JOIN section_master sec ON sec.id = s.section
         WHERE s.id = ? AND s.school_id = ? AND s.status != 4
         LIMIT 1`,
        [studentId, schoolId]
      );
      const student = stuRows?.[0] || null;
      if (!student) return null;

      const [attRows] = await pool.query(
        `SELECT * FROM student_assignment_attempts
         WHERE assignment_id = ? AND student_id = ? AND status = 1
         ORDER BY id DESC LIMIT 1`,
        [assignmentId, studentId]
      );
      const attempt = attRows?.[0] || null;

      const [questions] = await pool.query(
        `SELECT id, question, question_type, marks, instructions, correct_answer_text, status
         FROM assignment_questions
         WHERE assignment_id = ? AND school_id = ? AND (status != 4 OR status IS NULL)
         ORDER BY id ASC`,
        [assignmentId, schoolId]
      );

      if (questions.length > 0) {
        const questionIds = questions.map((q) => q.id);
        const [options] = await pool.query(
          `SELECT id, question_id, answer, is_correct, status
           FROM assignment_answers
           WHERE question_id IN (?) AND school_id = ? AND (status != 4 OR status IS NULL)
           ORDER BY id ASC`,
          [questionIds, schoolId]
        );

        let subSql = `SELECT question_id, selected_answer_id, answer_text, is_correct, marks_awarded, created_at
           FROM student_assignment_submissions
           WHERE assignment_id = ? AND student_id = ?`;
        const subParams = [assignmentId, studentId];
        if (attempt?.id) {
          subSql += ` AND attempt_id = ?`;
          subParams.push(attempt.id);
        }
        const [submissions] = await pool.query(subSql, subParams);

        const subMap = {};
        (submissions || []).forEach((s) => {
          subMap[s.question_id] = s;
        });

        questions.forEach((q) => {
          q.question_type = AcademicModel.normalizeQuestionType(q.question_type) || 'MCQ';
          q.question_type_label = AcademicModel.getQuestionTypeLabel(q.question_type);
          q.marks = q.marks != null ? Number(q.marks) : 1;
          const qOpts = (options || []).filter((o) => Number(o.question_id) === Number(q.id));
          q.options = qOpts;
          q.answers = qOpts;
          q.studentSubmission = subMap[q.id] || null;
        });
      }

      return {
        assignment,
        student,
        attempt,
        questions,
      };
    } catch (e) {
      console.error('Error in getStudentAssignmentSubmissionDetail:', e.message);
      throw e;
    }
  }

  // ==================== STUDENT PORTAL ASSIGNMENTS ====================
  static async getStudentDashboardAssignmentStats(studentId, schoolId, branchId, classId, sectionId) {
    await AcademicModel.ensureAssignmentSchema();
    const sql = `
      SELECT 
        a.id,
        (
          SELECT saa.id FROM student_assignment_attempts saa
          WHERE saa.assignment_id = a.id AND saa.student_id = ? AND saa.status = 1
          ORDER BY saa.id DESC LIMIT 1
        ) AS attempt_id
      FROM assignments a
      WHERE (a.school_id = ? OR ? IS NULL)
        AND (a.branch_id = ? OR a.branch_id IS NULL OR ? IS NULL)
        AND (a.class_id = ? OR ? IS NULL)
        AND (a.section_id = ? OR a.section_id IS NULL OR a.section_id = 0 OR ? IS NULL)
        AND (a.status != 4 OR a.status IS NULL)
        AND a.is_published = 1
    `;
    const [assignRows] = await pool.query(sql, [
      studentId,
      schoolId,
      schoolId,
      branchId,
      branchId,
      classId,
      classId,
      sectionId,
      sectionId,
    ]);
    const list = assignRows || [];
    const totalAssignments = list.length;
    const attemptedAssignments = list.filter((a) => a.attempt_id != null).length;
    const pendingAssignments = Math.max(0, totalAssignments - attemptedAssignments);
    return {
      totalAssignments,
      attemptedAssignments,
      pendingAssignments,
    };
  }

  static async getStudentAssignments(studentId, schoolId, branchId, classId, sectionId) {
    await AcademicModel.ensureAssignmentSchema();
    const sql = `
      SELECT 
        a.id,
        a.school_id,
        a.branch_id,
        a.title,
        a.assignment_type_id,
        at.type_name AS assignment_type,
        a.class_id,
        cm.class_name,
        a.section_id,
        sec.section_name,
        a.subject_id,
        COALESCE(sub.subject_name, 'General') AS subject_name,
        a.assigned_date,
        a.start_time,
        a.due_date,
        a.end_time,
        a.duration_minutes,
        COALESCE(a.total_marks, q.sum_marks, 0) AS total_marks,
        a.passing_marks,
        COALESCE(a.max_attempts, 1) AS max_attempts,
        a.instructions,
        a.status AS assignment_status,
        a.is_published,
        a.created_on,
        COALESCE(q.total_questions, 0) AS total_questions,
        COALESCE(att_stats.attempts_used, 0) AS attempts_used,
        in_prog.id AS in_progress_attempt_id,
        in_prog.started_at AS in_progress_started_at,
        att.id AS attempt_id,
        att.attempt_number,
        att.correct_answers,
        att.obtained_marks,
        att.total_marks AS attempt_total_marks,
        att.is_passed,
        att.score_percentage,
        att.attempted_at
      FROM assignments a
      LEFT JOIN assignment_types at ON a.assignment_type_id = at.id
      LEFT JOIN class_master cm ON a.class_id = cm.id
      LEFT JOIN section_master sec ON a.section_id = sec.id
      LEFT JOIN subject_master sub ON a.subject_id = sub.id
      LEFT JOIN (
        SELECT assignment_id, COUNT(*) AS total_questions, ROUND(SUM(COALESCE(marks, 1)), 2) AS sum_marks
        FROM assignment_questions
        WHERE status != 4 OR status IS NULL
        GROUP BY assignment_id
      ) q ON a.id = q.assignment_id
      LEFT JOIN (
        SELECT assignment_id, COUNT(*) AS attempts_used
        FROM student_assignment_attempts
        WHERE student_id = ? AND status = 1
        GROUP BY assignment_id
      ) att_stats ON a.id = att_stats.assignment_id
      LEFT JOIN student_assignment_attempts in_prog
        ON in_prog.id = (
          SELECT saa_ip.id FROM student_assignment_attempts saa_ip
          WHERE saa_ip.assignment_id = a.id AND saa_ip.student_id = ? AND saa_ip.status = 2
          ORDER BY saa_ip.id DESC LIMIT 1
        )
      LEFT JOIN student_assignment_attempts att
        ON att.id = (
          SELECT saa_last.id FROM student_assignment_attempts saa_last
          WHERE saa_last.assignment_id = a.id AND saa_last.student_id = ? AND saa_last.status = 1
          ORDER BY saa_last.id DESC LIMIT 1
        )
      WHERE (a.school_id = ? OR ? IS NULL)
        AND (a.branch_id = ? OR a.branch_id IS NULL OR ? IS NULL)
        AND (a.class_id = ? OR ? IS NULL)
        AND (a.section_id = ? OR a.section_id IS NULL OR a.section_id = 0 OR ? IS NULL)
        AND (a.status != 4 OR a.status IS NULL)
        AND a.is_published = 1
      ORDER BY a.id DESC
    `;

    const [rows] = await pool.query(sql, [
      studentId,
      studentId,
      studentId,
      schoolId,
      schoolId,
      branchId,
      branchId,
      classId,
      classId,
      sectionId,
      sectionId,
    ]);

    const now = new Date();
    const serverNowIso = now.toISOString();

    return (rows || []).map((row) => {
      const schedule = AcademicModel.getAssignmentScheduleState(row, now);
      const maxAttempts = Math.max(1, Number(row.max_attempts) || 1);
      const attemptsUsed = Number(row.attempts_used) || 0;
      const attemptsRemaining = Math.max(0, maxAttempts - attemptsUsed);
      const isAttempted = row.attempt_id != null && attemptsUsed > 0;
      const hasInProgress = row.in_progress_attempt_id != null && !schedule.isExpired;
      const canReattempt = isAttempted && attemptsRemaining > 0 && schedule.isAvailable;
      const canStart = (!isAttempted || canReattempt || hasInProgress) && schedule.isAvailable;

      let status = 'Pending';
      if (isAttempted && !hasInProgress) {
        status = 'Attempted';
      } else if (schedule.isExpired) {
        status = 'Expired';
      } else if (schedule.isNotStarted) {
        status = 'Scheduled';
      } else if (hasInProgress) {
        status = 'In Progress';
      }

      return {
        ...row,
        max_attempts: maxAttempts,
        attempts_used: attemptsUsed,
        attempts_remaining: attemptsRemaining,
        start_datetime: schedule.startDateTime,
        end_datetime: schedule.endDateTime,
        is_not_started: schedule.isNotStarted,
        is_expired: schedule.isExpired,
        is_available: schedule.isAvailable,
        has_in_progress: hasInProgress,
        can_attempt: canStart,
        can_reattempt: canReattempt,
        server_now: serverNowIso,
        status,
      };
    });
  }

  static async getStudentAssignmentForAttempt(assignmentId, studentId, schoolId) {
    await AcademicModel.ensureAssignmentSchema();

    // 1. Verify student and assignment
    const [stuRows] = await pool.query(
      `SELECT id, class, section, branch_id FROM student_master WHERE id = ? AND school_id = ? AND status != 4 LIMIT 1`,
      [studentId, schoolId]
    );
    const student = stuRows?.[0] || null;

    const [asgRows] = await pool.query(
      `SELECT 
         a.*,
         cm.class_name,
         sec.section_name,
         COALESCE(sub.subject_name, 'General') AS subject_name,
         at.type_name AS assignment_type
       FROM assignments a
       LEFT JOIN class_master cm ON a.class_id = cm.id
       LEFT JOIN section_master sec ON a.section_id = sec.id
       LEFT JOIN subject_master sub ON a.subject_id = sub.id
       LEFT JOIN assignment_types at ON a.assignment_type_id = at.id
       WHERE a.id = ? AND (a.school_id = ? OR ? IS NULL) AND (a.status != 4 OR a.status IS NULL) AND a.is_published = 1`,
      [assignmentId, schoolId, schoolId]
    );

    if (!asgRows || asgRows.length === 0) {
      const err = new Error('Assignment not found or not published.');
      err.statusCode = 404;
      throw err;
    }
    const assignment = asgRows[0];

    if (student && assignment.class_id && Number(student.class) !== Number(assignment.class_id)) {
      const err = new Error('This assignment is not assigned to your class.');
      err.statusCode = 403;
      throw err;
    }
    if (
      student &&
      assignment.section_id &&
      Number(assignment.section_id) > 0 &&
      student.section &&
      Number(student.section) !== Number(assignment.section_id)
    ) {
      const err = new Error('This assignment is not assigned to your section.');
      err.statusCode = 403;
      throw err;
    }

    const now = new Date();
    const nowMs = now.getTime();
    const schedule = AcademicModel.getAssignmentScheduleState(assignment, now);

    // Prevent access before scheduled start date & time
    if (schedule.isNotStarted) {
      const startDisplay = `${assignment.assigned_date || ''}${assignment.start_time ? ` at ${assignment.start_time}` : ''}`.trim();
      const err = new Error(
        `This assignment is scheduled to become available on ${startDisplay}. You cannot access it before the start time.`
      );
      err.statusCode = 403;
      err.data = {
        isNotStarted: true,
        assigned_date: assignment.assigned_date,
        start_time: assignment.start_time,
        start_datetime: schedule.startDateTime,
        server_now: now.toISOString(),
      };
      throw err;
    }

    const maxAttempts = Math.max(1, Number(assignment.max_attempts) || 1);

    // Check completed attempts and any active in-progress attempt
    const [completedAttRows] = await pool.query(
      `SELECT * FROM student_assignment_attempts
       WHERE assignment_id = ? AND student_id = ? AND status = 1
       ORDER BY id DESC`,
      [assignmentId, studentId]
    );
    const attemptsUsed = completedAttRows.length;
    const latestCompletedAttempt = completedAttRows[0] || null;

    const [inProgRows] = await pool.query(
      `SELECT * FROM student_assignment_attempts
       WHERE assignment_id = ? AND student_id = ? AND status = 2
       ORDER BY id DESC LIMIT 1`,
      [assignmentId, studentId]
    );
    let activeAttempt = inProgRows[0] || null;

    // Check if assignment end date/time has passed
    if (schedule.isExpired) {
      if (attemptsUsed === 0) {
        const err = new Error(
          'The deadline for this assignment has expired. You can no longer answer questions or submit this assignment.'
        );
        err.statusCode = 403;
        err.data = {
          isExpired: true,
          due_date: assignment.due_date,
          end_time: assignment.end_time,
          end_datetime: schedule.endDateTime,
          server_now: now.toISOString(),
          assignment: {
            id: assignment.id,
            title: assignment.title,
            due_date: assignment.due_date,
            end_time: assignment.end_time,
            subject_name: assignment.subject_name,
          },
        };
        throw err;
      }
      return {
        assignment: {
          ...assignment,
          start_datetime: schedule.startDateTime,
          end_datetime: schedule.endDateTime,
        },
        alreadyAttempted: latestCompletedAttempt,
        attemptsUsed,
        maxAttempts,
        attemptsRemaining: 0,
        isExpired: true,
        serverNow: now.toISOString(),
        questions: [],
      };
    }

    // If student has already used all allowed attempts and has no active in-progress attempt
    if (!activeAttempt && attemptsUsed >= maxAttempts) {
      return {
        assignment: {
          ...assignment,
          start_datetime: schedule.startDateTime,
          end_datetime: schedule.endDateTime,
        },
        alreadyAttempted: latestCompletedAttempt,
        attemptsUsed,
        maxAttempts,
        attemptsRemaining: 0,
        isExpired: false,
        serverNow: now.toISOString(),
        questions: [],
      };
    }

    // Fetch questions (strictly excluding correct_answer_text and is_correct)
    const [questions] = await pool.query(
      `SELECT id, question, question_type, marks, instructions, status
       FROM assignment_questions
       WHERE assignment_id = ? AND (status = 1 OR status IS NULL) AND status != 4
       ORDER BY id ASC`,
      [assignmentId]
    );

    let calculatedTotalMarks = 0;
    if (questions.length > 0) {
      const qIds = questions.map((q) => q.id);
      const [allOptions] = await pool.query(
        `SELECT id, question_id, answer, status
         FROM assignment_answers
         WHERE question_id IN (?) AND (status = 1 OR status IS NULL) AND status != 4
         ORDER BY id ASC`,
        [qIds]
      );

      for (const q of questions) {
        q.question_type = AcademicModel.normalizeQuestionType(q.question_type) || 'MCQ';
        q.question_type_label = AcademicModel.getQuestionTypeLabel(q.question_type);
        q.marks = q.marks != null ? Number(q.marks) : 1;
        calculatedTotalMarks = Number((calculatedTotalMarks + q.marks).toFixed(2));
        if (q.question_type === 'MCQ' || q.question_type === 'TRUE_FALSE') {
          q.options = (allOptions || []).filter((o) => Number(o.question_id) === Number(q.id));
        } else {
          q.options = [];
        }
      }
    }

    const effectiveTotalMarks =
      assignment.total_marks != null && Number(assignment.total_marks) > 0
        ? Number(assignment.total_marks)
        : calculatedTotalMarks;

    const branchId = student?.branch_id || assignment.branch_id || null;

    // Start an in-progress attempt on the server if none is active
    if (!activeAttempt) {
      const nextAttemptNumber = attemptsUsed + 1;
      const [insRes] = await pool.query(
        `INSERT INTO student_assignment_attempts (
           school_id, branch_id, assignment_id, student_id, attempt_number,
           total_questions, correct_answers, obtained_marks, total_marks,
           score_percentage, started_at, attempted_at, status
         ) VALUES (?, ?, ?, ?, ?, ?, 0, 0.00, ?, 0.00, NOW(), NOW(), 2)`,
        [schoolId, branchId, assignmentId, studentId, nextAttemptNumber, questions.length, effectiveTotalMarks]
      );
      const [newAttRows] = await pool.query(`SELECT * FROM student_assignment_attempts WHERE id = ? LIMIT 1`, [
        insRes.insertId,
      ]);
      activeAttempt = newAttRows[0] || {
        id: insRes.insertId,
        attempt_number: nextAttemptNumber,
        started_at: now,
      };
    }

    const startedAtDt = activeAttempt.started_at ? new Date(activeAttempt.started_at) : now;
    const startedAtMs = !isNaN(startedAtDt.getTime()) ? startedAtDt.getTime() : nowMs;
    const durationMinutes =
      assignment.duration_minutes != null && Number(assignment.duration_minutes) > 0
        ? Number(assignment.duration_minutes)
        : null;
    const endDt = AcademicModel.combineDateAndTime(assignment.due_date, assignment.end_time, true);
    const endDtMs = endDt ? endDt.getTime() : null;

    let effectiveDeadlineMs = endDtMs;
    if (durationMinutes) {
      const durationDeadlineMs = startedAtMs + durationMinutes * 60 * 1000;
      effectiveDeadlineMs = endDtMs ? Math.min(durationDeadlineMs, endDtMs) : durationDeadlineMs;
    }

    const remainingSeconds =
      effectiveDeadlineMs != null ? Math.max(0, Math.floor((effectiveDeadlineMs - nowMs) / 1000)) : null;

    return {
      assignment: {
        ...assignment,
        total_marks: effectiveTotalMarks,
        max_attempts: maxAttempts,
        start_datetime: schedule.startDateTime,
        end_datetime: schedule.endDateTime,
      },
      activeAttempt: {
        id: activeAttempt.id,
        attempt_number: Number(activeAttempt.attempt_number) || attemptsUsed + 1,
        started_at: startedAtDt.toISOString(),
      },
      alreadyAttempted: null,
      attemptsUsed,
      maxAttempts,
      attemptsRemaining: Math.max(0, maxAttempts - attemptsUsed),
      remainingSeconds,
      serverNow: now.toISOString(),
      isExpired: false,
      questions,
    };
  }

  static async submitStudentAssignmentAttempt(
    assignmentId,
    studentId,
    schoolId,
    { answers = {}, isAutoSubmit = false } = {},
    userBranchId = null
  ) {
    await AcademicModel.ensureAssignmentSchema();
    const connection = await pool.getConnection();
    try {
      await connection.beginTransaction();

      if (!answers || typeof answers !== 'object') {
        const err = new Error('Please provide answers to submit.');
        err.statusCode = 400;
        throw err;
      }

      const [asgRows] = await connection.query(
        `SELECT * FROM assignments WHERE id = ? AND (school_id = ? OR ? IS NULL) AND (status != 4 OR status IS NULL) AND is_published = 1`,
        [assignmentId, schoolId, schoolId]
      );

      if (asgRows.length === 0) {
        const err = new Error('Assignment not found.');
        err.statusCode = 404;
        throw err;
      }
      const assignment = asgRows[0];

      let branchId = userBranchId || null;
      if (!branchId) {
        const [stRow] = await connection.query(`SELECT branch_id FROM student_master WHERE id = ? LIMIT 1`, [studentId]);
        if (stRow.length && stRow[0].branch_id) branchId = stRow[0].branch_id;
      }
      if (!branchId && assignment.branch_id) {
        branchId = assignment.branch_id;
      }

      const now = new Date();
      const nowMs = now.getTime();
      const schedule = AcademicModel.getAssignmentScheduleState(assignment, now);

      if (schedule.isNotStarted) {
        const err = new Error('This assignment has not started yet. Submissions are not allowed before the start time.');
        err.statusCode = 403;
        throw err;
      }

      // Allow a 60-second grace buffer for auto-submit network transit when the countdown hits zero
      const AUTO_SUBMIT_GRACE_MS = 60 * 1000;
      const endDt = AcademicModel.combineDateAndTime(assignment.due_date, assignment.end_time, true);
      if (endDt && nowMs > endDt.getTime() + AUTO_SUBMIT_GRACE_MS) {
        const err = new Error('The deadline for this assignment has expired. Submissions are no longer accepted.');
        err.statusCode = 403;
        err.data = { isExpired: true, due_date: assignment.due_date, end_time: assignment.end_time };
        throw err;
      }

      const maxAttempts = Math.max(1, Number(assignment.max_attempts) || 1);
      const [completedAttRows] = await connection.query(
        `SELECT id FROM student_assignment_attempts WHERE assignment_id = ? AND student_id = ? AND status = 1`,
        [assignmentId, studentId]
      );
      const attemptsUsed = completedAttRows.length;

      const [inProgRows] = await connection.query(
        `SELECT * FROM student_assignment_attempts
         WHERE assignment_id = ? AND student_id = ? AND status = 2
         ORDER BY id DESC LIMIT 1 FOR UPDATE`,
        [assignmentId, studentId]
      );
      const activeAttempt = inProgRows[0] || null;

      if (!activeAttempt && attemptsUsed >= maxAttempts) {
        const err = new Error(`You have already used all ${maxAttempts} allowed attempt(s) for this assignment.`);
        err.statusCode = 403;
        throw err;
      }

      if (
        activeAttempt &&
        activeAttempt.started_at &&
        assignment.duration_minutes &&
        Number(assignment.duration_minutes) > 0
      ) {
        const startedAtMs = new Date(activeAttempt.started_at).getTime();
        const durationLimitMs = startedAtMs + Number(assignment.duration_minutes) * 60 * 1000;
        if (!isNaN(startedAtMs) && nowMs > durationLimitMs + AUTO_SUBMIT_GRACE_MS && !isAutoSubmit) {
          const err = new Error('Your allocated time duration for this assignment attempt has expired.');
          err.statusCode = 403;
          err.data = { isExpired: true };
          throw err;
        }
      }

      const [questions] = await connection.query(
        `SELECT q.id AS question_id, q.question_type, q.marks, q.correct_answer_text,
                a.id AS correct_answer_id, a.answer AS correct_option_text
         FROM assignment_questions q
         LEFT JOIN assignment_answers a ON (q.id = a.question_id AND a.is_correct = 1 AND (a.status = 1 OR a.status IS NULL) AND a.status != 4)
         WHERE q.assignment_id = ? AND (q.status = 1 OR q.status IS NULL) AND q.status != 4
         ORDER BY q.id ASC`,
        [assignmentId]
      );

      if (questions.length === 0) {
        const err = new Error('No questions found for this assignment.');
        err.statusCode = 400;
        throw err;
      }

      // Deduplicate questions in case a question has multiple rows joined
      const questionMap = new Map();
      for (const row of questions) {
        if (!questionMap.has(row.question_id)) {
          questionMap.set(row.question_id, {
            question_id: row.question_id,
            question_type: AcademicModel.normalizeQuestionType(row.question_type) || 'MCQ',
            marks: row.marks != null && Number(row.marks) > 0 ? Number(row.marks) : 1,
            correct_answer_text: row.correct_answer_text,
            correct_answer_ids: row.correct_answer_id ? [Number(row.correct_answer_id)] : [],
          });
        } else if (row.correct_answer_id) {
          questionMap.get(row.question_id).correct_answer_ids.push(Number(row.correct_answer_id));
        }
      }

      const uniqueQuestions = Array.from(questionMap.values());
      const totalQuestions = uniqueQuestions.length;
      let correctAnswersCount = 0;
      let obtainedMarks = 0;
      let calculatedTotalMarks = 0;

      const submissionRecords = [];
      for (const q of uniqueQuestions) {
        calculatedTotalMarks = Number((calculatedTotalMarks + q.marks).toFixed(2));
        const rawAns = answers[q.question_id];
        let selectedAnswerId = null;
        let answerText = null;
        let isCorrect = 0;
        let marksAwarded = 0;

        if (q.question_type === 'MCQ' || q.question_type === 'TRUE_FALSE') {
          if (rawAns !== undefined && rawAns !== null && String(rawAns).trim() !== '') {
            if (typeof rawAns === 'object') {
              selectedAnswerId = rawAns.selected_answer_id ? Number(rawAns.selected_answer_id) : null;
              answerText = rawAns.answer_text ? String(rawAns.answer_text).trim() : null;
            } else if (/^\d+$/.test(String(rawAns).trim())) {
              selectedAnswerId = Number(rawAns);
            } else {
              answerText = String(rawAns).trim();
            }
          }
          if (selectedAnswerId && q.correct_answer_ids.includes(selectedAnswerId)) {
            isCorrect = 1;
            marksAwarded = q.marks;
          }
        } else {
          // SHORT_ANSWER or LONG_ANSWER
          if (rawAns !== undefined && rawAns !== null) {
            answerText =
              typeof rawAns === 'object' ? String(rawAns.answer_text ?? rawAns.text ?? '').trim() : String(rawAns).trim();
          }
          if (answerText) {
            if (q.correct_answer_text && String(q.correct_answer_text).trim() !== '') {
              const expectedNorm = String(q.correct_answer_text).trim().toLowerCase().replace(/\s+/g, ' ');
              const givenNorm = answerText.toLowerCase().replace(/\s+/g, ' ');
              if (givenNorm === expectedNorm || (q.question_type === 'LONG_ANSWER' && givenNorm.includes(expectedNorm))) {
                isCorrect = 1;
                marksAwarded = q.marks;
              }
            } else {
              // No strict reference key configured: mark answered descriptive submission as completed
              isCorrect = 1;
              marksAwarded = q.marks;
            }
          }
        }

        if (isCorrect === 1) {
          correctAnswersCount++;
          obtainedMarks = Number((obtainedMarks + marksAwarded).toFixed(2));
        }

        submissionRecords.push({
          question_id: q.question_id,
          selected_answer_id: selectedAnswerId,
          answer_text: answerText,
          is_correct: isCorrect,
          marks_awarded: marksAwarded,
        });
      }

      const effectiveTotalMarks =
        assignment.total_marks != null && Number(assignment.total_marks) > 0
          ? Number(assignment.total_marks)
          : calculatedTotalMarks;

      const scorePercentage =
        effectiveTotalMarks > 0
          ? Number(((obtainedMarks / effectiveTotalMarks) * 100).toFixed(2))
          : totalQuestions > 0
          ? Number(((correctAnswersCount / totalQuestions) * 100).toFixed(2))
          : 0;

      const isPassed =
        assignment.passing_marks != null && Number(assignment.passing_marks) > 0
          ? obtainedMarks >= Number(assignment.passing_marks)
            ? 1
            : 0
          : scorePercentage >= 40
          ? 1
          : 0;

      let attemptId;
      const attemptNumber = activeAttempt ? Number(activeAttempt.attempt_number) || attemptsUsed + 1 : attemptsUsed + 1;

      if (activeAttempt) {
        attemptId = activeAttempt.id;
        await connection.query(
          `UPDATE student_assignment_attempts
           SET total_questions = ?,
               correct_answers = ?,
               obtained_marks = ?,
               total_marks = ?,
               score_percentage = ?,
               is_passed = ?,
               is_auto_submitted = ?,
               submitted_at = NOW(),
               attempted_at = NOW(),
               status = 1
           WHERE id = ?`,
          [
            totalQuestions,
            correctAnswersCount,
            obtainedMarks,
            effectiveTotalMarks,
            scorePercentage,
            isPassed,
            isAutoSubmit ? 1 : 0,
            attemptId,
          ]
        );
      } else {
        const [attRes] = await connection.query(
          `INSERT INTO student_assignment_attempts (
             school_id, branch_id, assignment_id, student_id, attempt_number,
             total_questions, correct_answers, obtained_marks, total_marks,
             score_percentage, is_passed, is_auto_submitted,
             started_at, submitted_at, attempted_at, status
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW(), NOW(), 1)`,
          [
            schoolId,
            branchId,
            assignmentId,
            studentId,
            attemptNumber,
            totalQuestions,
            correctAnswersCount,
            obtainedMarks,
            effectiveTotalMarks,
            scorePercentage,
            isPassed,
            isAutoSubmit ? 1 : 0,
          ]
        );
        attemptId = attRes.insertId;
      }

      await connection.query(`DELETE FROM student_assignment_submissions WHERE attempt_id = ?`, [attemptId]);

      for (const sub of submissionRecords) {
        await connection.query(
          `INSERT INTO student_assignment_submissions (
             school_id, branch_id, attempt_id, assignment_id, student_id,
             question_id, selected_answer_id, answer_text, is_correct, marks_awarded, created_at
           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
          [
            schoolId,
            branchId,
            attemptId,
            assignmentId,
            studentId,
            sub.question_id,
            sub.selected_answer_id,
            sub.answer_text,
            sub.is_correct,
            sub.marks_awarded,
          ]
        );
      }

      await connection.commit();

      return {
        attemptId,
        attemptNumber,
        totalQuestions,
        correctAnswersCount,
        obtainedMarks,
        totalMarks: effectiveTotalMarks,
        passingMarks: assignment.passing_marks != null ? Number(assignment.passing_marks) : null,
        isPassed: isPassed === 1,
        scorePercentage: scorePercentage.toFixed(2),
      };
    } catch (error) {
      await connection.rollback();
      throw error;
    } finally {
      connection.release();
    }
  }

  static async getStudentAssignmentResult(assignmentId, studentId, schoolId) {
    await AcademicModel.ensureAssignmentSchema();

    const [asgRows] = await pool.query(
      `SELECT 
         a.*,
         cm.class_name,
         sec.section_name,
         COALESCE(sub.subject_name, 'General') AS subject_name,
         at.type_name AS assignment_type
       FROM assignments a
       LEFT JOIN class_master cm ON a.class_id = cm.id
       LEFT JOIN section_master sec ON a.section_id = sec.id
       LEFT JOIN subject_master sub ON a.subject_id = sub.id
       LEFT JOIN assignment_types at ON a.assignment_type_id = at.id
       WHERE a.id = ? AND (a.school_id = ? OR ? IS NULL)`,
      [assignmentId, schoolId, schoolId]
    );
    if (asgRows.length === 0) {
      return null;
    }
    const assignment = asgRows[0];

    const [attRows] = await pool.query(
      `SELECT * FROM student_assignment_attempts
       WHERE assignment_id = ? AND student_id = ? AND status = 1
       ORDER BY id DESC`,
      [assignmentId, studentId]
    );
    const attempt = attRows[0] || null;

    const [questions] = await pool.query(
      `SELECT id, question, question_type, marks, instructions, correct_answer_text
       FROM assignment_questions
       WHERE assignment_id = ? AND (status = 1 OR status IS NULL) AND status != 4
       ORDER BY id ASC`,
      [assignmentId]
    );

    let subSql = `SELECT question_id, selected_answer_id, answer_text, is_correct, marks_awarded
       FROM student_assignment_submissions
       WHERE assignment_id = ? AND student_id = ?`;
    const subParams = [assignmentId, studentId];
    if (attempt?.id) {
      subSql += ` AND attempt_id = ?`;
      subParams.push(attempt.id);
    }
    const [submissions] = await pool.query(subSql, subParams);
    const subMap = {};
    (submissions || []).forEach((s) => {
      subMap[s.question_id] = s;
    });

    for (const q of questions) {
      q.question_type = AcademicModel.normalizeQuestionType(q.question_type) || 'MCQ';
      q.question_type_label = AcademicModel.getQuestionTypeLabel(q.question_type);
      q.marks = q.marks != null ? Number(q.marks) : 1;
      const [options] = await pool.query(
        `SELECT id, answer, is_correct
         FROM assignment_answers
         WHERE question_id = ? AND (status = 1 OR status IS NULL) AND status != 4
         ORDER BY id ASC`,
        [q.id]
      );
      q.options = options;
      q.studentSubmission = subMap[q.id] || null;
    }

    return {
      assignment,
      attempt,
      attemptsHistory: attRows,
      attemptsUsed: attRows.length,
      maxAttempts: Math.max(1, Number(assignment.max_attempts) || 1),
      questions,
    };
  }

  static async getStudentPerformance(studentId, schoolId, { branchId = null, teacherId = null } = {}) {
    try {
      const cleanBranchId = AcademicModel.parseBranchId(branchId);

      let stuSql = `
        SELECT
          s.id,
          s.school_id,
          s.branch_id,
          s.admission_number,
          s.roll_number,
          s.first_name,
          s.last_name,
          CONCAT(TRIM(IFNULL(s.first_name, '')), ' ', TRIM(IFNULL(s.last_name, ''))) AS full_name,
          s.picture,
          s.class AS class_id,
          cm.class_name,
          s.section AS section_id,
          sec.section_name
        FROM student_master s
        LEFT JOIN class_master cm ON cm.id = s.class
        LEFT JOIN section_master sec ON sec.id = s.section
        WHERE s.id = ? AND s.school_id = ? AND s.status != 4
      `;
      const stuParams = [studentId, schoolId];
      if (cleanBranchId) {
        stuSql += ` AND (s.branch_id = ? OR s.branch_id IS NULL)`;
        stuParams.push(cleanBranchId);
      }
      stuSql += ` LIMIT 1`;

      const [stuRows] = await pool.query(stuSql, stuParams);
      const student = stuRows?.[0] || null;
      if (!student) return null;

      let allowedSubjectIds = null; // null means all subjects for this student's class
      if (teacherId) {
        const [tcaRows] = await pool.query(
          `SELECT class_id, subject_id FROM teacher_class_assign
           WHERE teacher_id = ? AND school_id = ? AND status = 1`,
          [teacherId, schoolId]
        );
        const [tmRows] = await pool.query(
          `SELECT class, subject FROM teacher_master
           WHERE id = ? AND school_id = ? AND status != 4 LIMIT 1`,
          [teacherId, schoolId]
        );

        const classMatches = (tcaRows || []).filter((r) => Number(r.class_id) === Number(student.class_id));
        const isPrimaryClassTeacher = Number(tmRows?.[0]?.class) === Number(student.class_id);

        if ((tcaRows || []).length > 0 && classMatches.length === 0 && !isPrimaryClassTeacher) {
          return null;
        }

        const hasFullClassRow = classMatches.some((r) => !r.subject_id || Number(r.subject_id) === 0);
        const subjectIdsSet = new Set(
          classMatches.map((r) => Number(r.subject_id)).filter((id) => id > 0)
        );
        if (tmRows?.[0]?.subject && Number(tmRows[0].subject) > 0 && isPrimaryClassTeacher) {
          subjectIdsSet.add(Number(tmRows[0].subject));
        }

        if (!isPrimaryClassTeacher && !hasFullClassRow && subjectIdsSet.size > 0) {
          allowedSubjectIds = Array.from(subjectIdsSet);
        }
      }

      let asgSql = `
        SELECT
          a.id,
          a.school_id,
          a.branch_id,
          a.title,
          a.assignment_type_id,
          at.type_name AS assignment_type,
          a.class_id,
          cm.class_name,
          a.section_id,
          sec.section_name,
          a.subject_id,
          sub.subject_name,
          a.assigned_date,
          a.due_date,
          a.is_published,
          a.created_on,
          COALESCE(q.total_questions, 0) AS total_questions,
          att.id AS attempt_id,
          att.correct_answers,
          att.score_percentage,
          att.attempted_at
        FROM assignments a
        LEFT JOIN assignment_types at ON a.assignment_type_id = at.id
        LEFT JOIN class_master cm ON a.class_id = cm.id
        LEFT JOIN section_master sec ON a.section_id = sec.id
        LEFT JOIN subject_master sub ON a.subject_id = sub.id
        LEFT JOIN (
          SELECT assignment_id, COUNT(*) AS total_questions
          FROM assignment_questions
          WHERE status != 4 OR status IS NULL
          GROUP BY assignment_id
        ) q ON a.id = q.assignment_id
        LEFT JOIN student_assignment_attempts att
          ON (a.id = att.assignment_id AND att.student_id = ? AND (att.status != 4 OR att.status IS NULL))
        WHERE a.school_id = ?
          AND (a.status != 4 OR a.status IS NULL)
          AND a.is_published = 1
          AND (
            (
              a.class_id = ?
              AND (a.section_id = ? OR a.section_id IS NULL OR a.section_id = 0 OR ? IS NULL)
            )
            OR att.id IS NOT NULL
          )
      `;
      const asgParams = [
        student.id,
        schoolId,
        student.class_id,
        student.section_id,
        student.section_id,
      ];

      if (Array.isArray(allowedSubjectIds) && allowedSubjectIds.length > 0) {
        asgSql += ` AND a.subject_id IN (?)`;
        asgParams.push(allowedSubjectIds);
      }

      asgSql += ` ORDER BY a.id DESC`;
      const [rawAssignments] = await pool.query(asgSql, asgParams);

      let submittedCount = 0;
      let pendingCount = 0;
      let missedCount = 0;
      let totalQuestionsAttempted = 0;
      let totalCorrectAnswers = 0;
      const allScores = [];
      const subjectMap = {};
      const typeMap = {};

      const evaluatedAssignments = (rawAssignments || []).map((row) => {
        const isSubmitted = row.attempt_id != null;
        const isExpired = !isSubmitted && AcademicModel.isAssignmentDeadlineExpired(row.due_date);
        const submissionStatus = isSubmitted ? 'Submitted' : isExpired ? 'Missed' : 'Pending';
        const scoreVal = isSubmitted && row.score_percentage != null ? Number(row.score_percentage) : null;

        if (isSubmitted) {
          submittedCount++;
          totalQuestionsAttempted += Number(row.total_questions || 0);
          totalCorrectAnswers += Number(row.correct_answers || 0);
          if (scoreVal != null) {
            allScores.push(scoreVal);
          }
        } else if (isExpired) {
          missedCount++;
        } else {
          pendingCount++;
        }

        const subKey = row.subject_id || `sub_${row.subject_name}`;
        if (!subjectMap[subKey]) {
          subjectMap[subKey] = {
            subject_id: row.subject_id,
            subject_name: row.subject_name || '',
            total_assigned: 0,
            submitted_count: 0,
            pending_count: 0,
            missed_count: 0,
            scores: [],
          };
        }
        subjectMap[subKey].total_assigned++;
        if (isSubmitted) {
          subjectMap[subKey].submitted_count++;
          if (scoreVal != null) subjectMap[subKey].scores.push(scoreVal);
        } else if (isExpired) {
          subjectMap[subKey].missed_count++;
        } else {
          subjectMap[subKey].pending_count++;
        }

        const typeName = row.assignment_type || '';
        const typeKey = row.assignment_type_id || `type_${typeName}`;
        if (!typeMap[typeKey]) {
          typeMap[typeKey] = {
            assignment_type_id: row.assignment_type_id,
            type_name: typeName,
            total_assigned: 0,
            submitted_count: 0,
            pending_count: 0,
            missed_count: 0,
            scores: [],
          };
        }
        typeMap[typeKey].total_assigned++;
        if (isSubmitted) {
          typeMap[typeKey].submitted_count++;
          if (scoreVal != null) typeMap[typeKey].scores.push(scoreVal);
        } else if (isExpired) {
          typeMap[typeKey].missed_count++;
        } else {
          typeMap[typeKey].pending_count++;
        }

        return {
          ...row,
          is_submitted: isSubmitted,
          is_expired: isExpired,
          submission_status: submissionStatus,
          status: isSubmitted ? 'Attempted' : isExpired ? 'Expired' : 'Pending',
          score_percentage: scoreVal,
          correct_answers: isSubmitted ? Number(row.correct_answers || 0) : null,
        };
      });

      const totalAssigned = evaluatedAssignments.length;
      const completionRate = totalAssigned > 0 ? Number(((submittedCount / totalAssigned) * 100).toFixed(2)) : 0;
      const averageScore =
        allScores.length > 0
          ? Number((allScores.reduce((a, b) => a + b, 0) / allScores.length).toFixed(2))
          : null;
      const highestScore = allScores.length > 0 ? Number(Math.max(...allScores).toFixed(2)) : null;
      const lowestScore = allScores.length > 0 ? Number(Math.min(...allScores).toFixed(2)) : null;

      const subjectPerformance = Object.values(subjectMap).map((s) => ({
        subject_id: s.subject_id,
        subject_name: s.subject_name,
        total_assigned: s.total_assigned,
        submitted_count: s.submitted_count,
        pending_count: s.pending_count,
        missed_count: s.missed_count,
        completion_rate:
          s.total_assigned > 0 ? Number(((s.submitted_count / s.total_assigned) * 100).toFixed(2)) : 0,
        average_score:
          s.scores.length > 0
            ? Number((s.scores.reduce((a, b) => a + b, 0) / s.scores.length).toFixed(2))
            : null,
      }));

      const typePerformance = Object.values(typeMap).map((t) => ({
        assignment_type_id: t.assignment_type_id,
        type_name: t.type_name,
        total_assigned: t.total_assigned,
        submitted_count: t.submitted_count,
        pending_count: t.pending_count,
        missed_count: t.missed_count,
        completion_rate:
          t.total_assigned > 0 ? Number(((t.submitted_count / t.total_assigned) * 100).toFixed(2)) : 0,
        average_score:
          t.scores.length > 0
            ? Number((t.scores.reduce((a, b) => a + b, 0) / t.scores.length).toFixed(2))
            : null,
      }));

      let examResults = [];
      try {
        const ParentModel = require('./parent.model');
        const rawExams = await ParentModel.getChildExamResults(student.id, schoolId);
        if (Array.isArray(allowedSubjectIds) && allowedSubjectIds.length > 0) {
          examResults = (rawExams || [])
            .map((ex) => {
              const filteredSubjects = (ex.subjects || []).filter((sub) =>
                allowedSubjectIds.includes(Number(sub.subject_id))
              );
              const filteredMarks = (ex.marks || []).filter((m) =>
                allowedSubjectIds.includes(Number(m.subject_id))
              );
              const obtainedMarks = filteredSubjects.reduce((sum, s) => sum + Number(s.obtained || 0), 0);
              const totalMarks = filteredSubjects.reduce((sum, s) => sum + Number(s.full_marks || 0), 0);
              const percentage = totalMarks > 0 ? Math.round((obtainedMarks / totalMarks) * 100) : 0;
              return {
                ...ex,
                subjects: filteredSubjects,
                marks: filteredMarks,
                obtainedMarks,
                totalMarks,
                percentage,
              };
            })
            .filter((ex) => ex.subjects.length > 0);
        } else {
          examResults = rawExams || [];
        }
      } catch (examErr) {
        console.error('Error fetching student exam results in getStudentPerformance:', examErr.message);
      }

      return {
        student,
        summary: {
          total_assigned: totalAssigned,
          submitted_count: submittedCount,
          pending_count: pendingCount,
          missed_count: missedCount,
          completion_rate: completionRate,
          average_score: averageScore,
          highest_score: highestScore,
          lowest_score: lowestScore,
          total_questions_attempted: totalQuestionsAttempted,
          total_correct_answers: totalCorrectAnswers,
        },
        subject_performance: subjectPerformance,
        type_performance: typePerformance,
        assignments: evaluatedAssignments,
        exam_results: examResults,
      };
    } catch (e) {
      console.error('Error in getStudentPerformance:', e.message);
      throw e;
    }
  }

  // ==================== STUDY MATERIALS ====================
  static async getMaterialTypes(schoolId, { search, status, page = 1, limit = 100, branchId = null, branch_id = null } = {}) {
    try {
      const cleanBranchId = AcademicModel.parseBranchId(branchId ?? branch_id);
      let baseSql = `FROM material_types mt
        LEFT JOIN branch_master bm ON mt.branch_id = bm.id
        WHERE mt.school_id = ?`;
      const params = [schoolId];

      if (cleanBranchId) {
        baseSql += ` AND mt.branch_id = ?`;
        params.push(cleanBranchId);
      }

      if (status !== undefined && status !== null && String(status).trim() !== '') {
        baseSql += ` AND mt.status = ?`;
        params.push(Number(status));
      } else {
        baseSql += ` AND (mt.status != 4 OR mt.status IS NULL)`;
      }

      if (search && String(search).trim()) {
        baseSql += ` AND (mt.material_type_name LIKE ? OR mt.description LIKE ?)`;
        params.push(`%${String(search).trim()}%`, `%${String(search).trim()}%`);
      }

      const countSql = `SELECT COUNT(*) AS total ${baseSql}`;
      const [countRows] = await pool.query(countSql, params);
      const total = countRows[0]?.total || 0;

      const numLimit = Math.max(1, Number(limit) || 100);
      const numPage = Math.max(1, Number(page) || 1);
      const offset = (numPage - 1) * numLimit;

      const dataSql = `SELECT mt.*, bm.branch_name, bm.branch_code ${baseSql} ORDER BY mt.display_order ASC, mt.id ASC LIMIT ? OFFSET ?`;
      const [rows] = await pool.query(dataSql, [...params, numLimit, offset]);

      return {
        material_types: rows || [],
        total,
        page: numPage,
        limit: numLimit,
        totalPages: Math.ceil(total / numLimit) || 1,
      };
    } catch (e) {
      console.error('Error in getMaterialTypes:', e.message);
      return {
        material_types: [],
        total: 0,
        page: 1,
        limit: 100,
        totalPages: 1,
      };
    }
  }

  static async getMaterialTypeById(id, schoolId, branchId = null) {
    try {
      const cleanBranchId = AcademicModel.parseBranchId(branchId);
      let sql = `SELECT mt.*, bm.branch_name, bm.branch_code
         FROM material_types mt
         LEFT JOIN branch_master bm ON mt.branch_id = bm.id
         WHERE mt.id = ? AND mt.school_id = ? AND (mt.status != 4 OR mt.status IS NULL)`;
      const params = [id, schoolId];
      if (cleanBranchId) {
        sql += ` AND mt.branch_id = ?`;
        params.push(cleanBranchId);
      }
      sql += ` LIMIT 1`;
      const [rows] = await pool.query(sql, params);
      return rows[0] || null;
    } catch (e) {
      console.error('Error in getMaterialTypeById:', e.message);
      return null;
    }
  }

  static async createMaterialType(schoolId, { material_type_name, description = '', display_order = 0, status = 1, branch_id = null, branchId = null }) {
    const cleanName = String(material_type_name || '').trim();
    if (!cleanName) {
      const err = new Error('Material type name is required.');
      err.statusCode = 400;
      throw err;
    }

    const resolvedBranchId = await AcademicModel.resolveDefaultBranchId(schoolId, branch_id ?? branchId);

    // Branch-scoped duplicate check
    let dupSql = `SELECT id FROM material_types WHERE school_id = ? AND LOWER(TRIM(material_type_name)) = LOWER(TRIM(?)) AND (status != 4 OR status IS NULL)`;
    const dupParams = [schoolId, cleanName];
    if (resolvedBranchId) {
      dupSql += ` AND branch_id = ?`;
      dupParams.push(resolvedBranchId);
    } else {
      dupSql += ` AND branch_id IS NULL`;
    }
    dupSql += ` LIMIT 1`;
    const [existing] = await pool.query(dupSql, dupParams);
    if (existing && existing.length > 0) {
      const err = new Error(`A material type named "${cleanName}" already exists in this branch.`);
      err.statusCode = 400;
      throw err;
    }

    const [result] = await pool.query(
      `INSERT INTO material_types (school_id, branch_id, material_type_name, description, display_order, status, created_at) VALUES (?, ?, ?, ?, ?, ?, NOW())`,
      [schoolId, resolvedBranchId, cleanName, description || '', display_order || 0, status !== undefined ? Number(status) : 1]
    );
    return result.insertId;
  }

  static async updateMaterialType(id, schoolId, { material_type_name, description, display_order, status, branch_id = null }, branchId = null) {
    const filterBranch = AcademicModel.parseBranchId(branchId);

    // Verify existing material type belongs to this school and branch
    let checkSql = `SELECT id, branch_id, material_type_name FROM material_types WHERE id = ? AND school_id = ? AND (status != 4 OR status IS NULL)`;
    const checkParams = [id, schoolId];
    if (filterBranch) {
      checkSql += ` AND branch_id = ?`;
      checkParams.push(filterBranch);
    }
    checkSql += ` LIMIT 1`;
    const [existingRows] = await pool.query(checkSql, checkParams);
    if (!existingRows || existingRows.length === 0) {
      return false;
    }
    const existingRow = existingRows[0];
    const targetBranchId = AcademicModel.parseBranchId(branch_id) || filterBranch || AcademicModel.parseBranchId(existingRow.branch_id);

    if (material_type_name && String(material_type_name).trim()) {
      const cleanName = String(material_type_name).trim();
      let dupSql = `SELECT id FROM material_types WHERE school_id = ? AND LOWER(TRIM(material_type_name)) = LOWER(TRIM(?)) AND id != ? AND (status != 4 OR status IS NULL)`;
      const dupParams = [schoolId, cleanName, id];
      if (targetBranchId) {
        dupSql += ` AND branch_id = ?`;
        dupParams.push(targetBranchId);
      } else {
        dupSql += ` AND branch_id IS NULL`;
      }
      dupSql += ` LIMIT 1`;
      const [existing] = await pool.query(dupSql, dupParams);
      if (existing && existing.length > 0) {
        const err = new Error(`Another material type named "${cleanName}" already exists in this branch.`);
        err.statusCode = 400;
        throw err;
      }
    }

    let sql = `UPDATE material_types 
       SET material_type_name = COALESCE(?, material_type_name),
           description = COALESCE(?, description),
           display_order = COALESCE(?, display_order),
           status = COALESCE(?, status)
       WHERE id = ? AND school_id = ?`;
    const params = [
      material_type_name ? String(material_type_name).trim() : null,
      description !== undefined ? description : null,
      display_order !== undefined ? display_order : null,
      status !== undefined ? status : null,
      id,
      schoolId,
    ];
    if (filterBranch) {
      sql += ` AND branch_id = ?`;
      params.push(filterBranch);
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  static async deleteMaterialType(id, schoolId, branchId = null) {
    const cleanBranchId = AcademicModel.parseBranchId(branchId);
    let sql = `UPDATE material_types SET status = 4 WHERE id = ? AND school_id = ? AND (status != 4 OR status IS NULL)`;
    const params = [id, schoolId];
    if (cleanBranchId) {
      sql += ` AND branch_id = ?`;
      params.push(cleanBranchId);
    }
    const [result] = await pool.query(sql, params);
    return result.affectedRows > 0;
  }

  /**
   * Validates that class_id, section_id, subject_id, material_type_id, academic_year_id
   * belong to the specified school_id and branch_id (and teacher assignments if teacherId is provided),
   * and enforces branch-scoped duplicate validation on study_materials.
   */
  static async validateStudyMaterialRelations(schoolId, branchId, data, teacherId = null, excludeMaterialId = null) {
    const cleanBranchId = AcademicModel.parseBranchId(branchId);
    const {
      academic_year_id,
      class_id,
      section_id,
      subject_id,
      material_type_id,
      title,
    } = data;

    if (!title || !String(title).trim()) {
      const err = new Error('Study material title is required.');
      err.statusCode = 400;
      throw err;
    }
    if (!class_id) {
      const err = new Error('Class is required.');
      err.statusCode = 400;
      throw err;
    }
    if (!subject_id) {
      const err = new Error('Subject is required.');
      err.statusCode = 400;
      throw err;
    }

    // 1. Validate Class belongs to school and branch
    let clsSql = `SELECT id, branch_id, class_name FROM class_master WHERE id = ? AND school_id = ? AND (status != 4 OR status IS NULL)`;
    const clsParams = [class_id, schoolId];
    if (cleanBranchId) {
      clsSql += ` AND branch_id = ?`;
      clsParams.push(cleanBranchId);
    }
    clsSql += ` LIMIT 1`;
    const [clsRows] = await pool.query(clsSql, clsParams);
    if (!clsRows || clsRows.length === 0) {
      const err = new Error('Selected class does not belong to the authorized school and branch.');
      err.statusCode = 400;
      throw err;
    }

    const effectiveBranchId = cleanBranchId || AcademicModel.parseBranchId(clsRows[0].branch_id);

    // If teacherId is provided, verify teacher belongs to this school/branch and is assigned to this class
    if (teacherId) {
      let tSql = `SELECT id, branch_id, class, subject FROM teacher_master WHERE id = ? AND school_id = ? AND status != 4`;
      const tParams = [teacherId, schoolId];
      if (effectiveBranchId) {
        tSql += ` AND branch_id = ?`;
        tParams.push(effectiveBranchId);
      }
      tSql += ` LIMIT 1`;
      const [tRows] = await pool.query(tSql, tParams);
      if (!tRows || tRows.length === 0) {
        const err = new Error('Teacher does not belong to the authorized school and branch.');
        err.statusCode = 403;
        throw err;
      }

      const [tcaCountRows] = await pool.query(
        `SELECT COUNT(*) AS cnt FROM teacher_class_assign WHERE teacher_id = ? AND school_id = ? AND status = 1`,
        [teacherId, schoolId]
      );
      const hasClassAssignments = (tcaCountRows?.[0]?.cnt || 0) > 0;
      if (hasClassAssignments) {
        const [assignedCls] = await pool.query(
          `SELECT id FROM teacher_class_assign WHERE teacher_id = ? AND school_id = ? AND class_id = ? AND status = 1 LIMIT 1`,
          [teacherId, schoolId, class_id]
        );
        const isPrimaryClass = Number(tRows[0].class) === Number(class_id);
        if ((!assignedCls || assignedCls.length === 0) && !isPrimaryClass) {
          const err = new Error('You are not assigned to the selected class in your branch.');
          err.statusCode = 403;
          throw err;
        }
      }
    }

    // 2. Validate Section (if provided) belongs to school, branch, and class
    if (section_id !== undefined && section_id !== null && String(section_id).trim() !== '' && Number(section_id) > 0) {
      let secSql = `SELECT sec.id FROM section_master sec
        LEFT JOIN class_master cm ON sec.class_id = cm.id
        WHERE sec.id = ? AND sec.school_id = ? AND sec.class_id = ? AND (sec.status != 4 OR sec.status IS NULL)`;
      const secParams = [section_id, schoolId, class_id];
      if (effectiveBranchId) {
        secSql += ` AND COALESCE(sec.branch_id, cm.branch_id) = ?`;
        secParams.push(effectiveBranchId);
      }
      secSql += ` LIMIT 1`;
      const [secRows] = await pool.query(secSql, secParams);
      if (!secRows || secRows.length === 0) {
        const err = new Error('Selected section does not belong to the selected class and branch.');
        err.statusCode = 400;
        throw err;
      }
    }

    // 3. Validate Subject belongs to school, branch, and class
    let subSql = `SELECT sm.id FROM subject_master sm
      LEFT JOIN class_master cm ON sm.class_id = cm.id
      WHERE sm.id = ? AND sm.school_id = ? AND (sm.class_id = ? OR sm.class_id IS NULL) AND (sm.status != 4 OR sm.status IS NULL)`;
    const subParams = [subject_id, schoolId, class_id];
    if (effectiveBranchId) {
      subSql += ` AND COALESCE(sm.branch_id, cm.branch_id) = ?`;
      subParams.push(effectiveBranchId);
    }
    subSql += ` LIMIT 1`;
    const [subRows] = await pool.query(subSql, subParams);
    if (!subRows || subRows.length === 0) {
      const err = new Error('Selected subject does not belong to the selected class and branch.');
      err.statusCode = 400;
      throw err;
    }

    // If teacherId is provided and teacher has subject assignments for this class, verify subject assignment
    if (teacherId) {
      const [tcaSubCount] = await pool.query(
        `SELECT COUNT(*) AS cnt FROM teacher_class_assign WHERE teacher_id = ? AND school_id = ? AND class_id = ? AND subject_id > 0 AND status = 1`,
        [teacherId, schoolId, class_id]
      );
      if ((tcaSubCount?.[0]?.cnt || 0) > 0) {
        const [assignedSub] = await pool.query(
          `SELECT id FROM teacher_class_assign WHERE teacher_id = ? AND school_id = ? AND class_id = ? AND subject_id = ? AND status = 1 LIMIT 1`,
          [teacherId, schoolId, class_id, subject_id]
        );
        if (!assignedSub || assignedSub.length === 0) {
          const err = new Error('You are not assigned to teach the selected subject for this class.');
          err.statusCode = 403;
          throw err;
        }
      }
    }

    // 4. Validate Material Type (if provided) belongs to school and branch
    if (material_type_id !== undefined && material_type_id !== null && String(material_type_id).trim() !== '' && Number(material_type_id) > 0) {
      let mtSql = `SELECT id FROM material_types WHERE id = ? AND school_id = ? AND (status != 4 OR status IS NULL)`;
      const mtParams = [material_type_id, schoolId];
      if (effectiveBranchId) {
        mtSql += ` AND branch_id = ?`;
        mtParams.push(effectiveBranchId);
      }
      mtSql += ` LIMIT 1`;
      const [mtRows] = await pool.query(mtSql, mtParams);
      if (!mtRows || mtRows.length === 0) {
        const err = new Error('Selected material type does not belong to the authorized school and branch.');
        err.statusCode = 400;
        throw err;
      }
    }

    // 5. Validate Academic Year (if provided) belongs to school and branch
    if (academic_year_id !== undefined && academic_year_id !== null && String(academic_year_id).trim() !== '' && Number(academic_year_id) > 0) {
      let aySql = `SELECT id FROM academic_year_master WHERE id = ? AND school_id = ? AND (status != 4 OR status IS NULL)`;
      const ayParams = [academic_year_id, schoolId];
      if (effectiveBranchId) {
        aySql += ` AND (branch_id = ? OR branch_id IS NULL)`;
        ayParams.push(effectiveBranchId);
      }
      aySql += ` LIMIT 1`;
      const [ayRows] = await pool.query(aySql, ayParams);
      if (!ayRows || ayRows.length === 0) {
        const err = new Error('Selected academic year does not belong to the authorized school and branch.');
        err.statusCode = 400;
        throw err;
      }
    }

    // 6. Branch-scoped duplicate check (same title + class + section + subject within the same school and branch)
    let dupSql = `SELECT id FROM study_materials
      WHERE school_id = ?
        AND class_id = ?
        AND subject_id = ?
        AND COALESCE(section_id, 0) = COALESCE(?, 0)
        AND LOWER(TRIM(title)) = LOWER(TRIM(?))
        AND (status != 4 OR status IS NULL)`;
    const dupParams = [
      schoolId,
      class_id,
      subject_id,
      section_id && Number(section_id) > 0 ? Number(section_id) : 0,
      String(title).trim(),
    ];
    if (effectiveBranchId) {
      dupSql += ` AND branch_id = ?`;
      dupParams.push(effectiveBranchId);
    } else {
      dupSql += ` AND branch_id IS NULL`;
    }
    if (excludeMaterialId) {
      dupSql += ` AND id != ?`;
      dupParams.push(excludeMaterialId);
    }
    dupSql += ` LIMIT 1`;
    const [dupRows] = await pool.query(dupSql, dupParams);
    if (dupRows && dupRows.length > 0) {
      const err = new Error(`A study material titled "${String(title).trim()}" already exists for this class and subject in this branch.`);
      err.statusCode = 400;
      throw err;
    }

    return effectiveBranchId;
  }

  static async getStudyMaterials(schoolId, { academic_year_id, class_id, section_id, subject_id, material_type_id, status, search, uploaded_by, uploader_type, teacherId = null, page = 1, limit = 10, branchId = null, branch_id = null } = {}) {
    try {
      let whereClauses = [
        'sm.school_id = ?',
        '(sm.status != 4 OR sm.status IS NULL)',
      ];
      const params = [schoolId];

      const effectiveBranchId = AcademicModel.parseBranchId(branchId ?? branch_id);
      if (effectiveBranchId) {
        whereClauses.push('COALESCE(sm.branch_id, cm.branch_id) = ?');
        params.push(effectiveBranchId);
      }

      // If requested by a teacher in Teacher Portal, enforce teacher's assigned classes/permissions within the branch
      if (teacherId) {
        whereClauses.push(`(
          (sm.uploaded_by = ? AND sm.uploader_type = 'teacher')
          OR EXISTS (
            SELECT 1 FROM teacher_class_assign tca
            WHERE tca.teacher_id = ? AND tca.school_id = sm.school_id AND tca.class_id = sm.class_id AND tca.status = 1
          )
          OR EXISTS (
            SELECT 1 FROM teacher_master tm_cls
            WHERE tm_cls.id = ? AND tm_cls.school_id = sm.school_id AND tm_cls.class = sm.class_id AND tm_cls.status = 1
          )
          OR NOT EXISTS (
            SELECT 1 FROM teacher_class_assign tca_any
            WHERE tca_any.teacher_id = ? AND tca_any.school_id = sm.school_id AND tca_any.status = 1
          )
        )`);
        params.push(teacherId, teacherId, teacherId, teacherId);
      }

      const isValidVal = (v) => v !== undefined && v !== null && String(v).trim() !== '' && String(v).trim() !== 'undefined' && String(v).trim() !== 'null';

      if (isValidVal(academic_year_id)) {
        whereClauses.push('sm.academic_year_id = ?');
        params.push(academic_year_id);
      }
      if (isValidVal(class_id)) {
        whereClauses.push('sm.class_id = ?');
        params.push(class_id);
      }
      if (isValidVal(section_id)) {
        whereClauses.push('(sm.section_id = ? OR sm.section_id = 0 OR sm.section_id IS NULL)');
        params.push(section_id);
      }
      if (isValidVal(subject_id)) {
        whereClauses.push('sm.subject_id = ?');
        params.push(subject_id);
      }
      if (isValidVal(material_type_id)) {
        whereClauses.push('sm.material_type_id = ?');
        params.push(material_type_id);
      }
      if (isValidVal(uploaded_by)) {
        whereClauses.push('sm.uploaded_by = ?');
        params.push(uploaded_by);
      }
      if (isValidVal(uploader_type)) {
        whereClauses.push('sm.uploader_type = ?');
        params.push(uploader_type);
      }
      if (isValidVal(status)) {
        if (Number(status) === 1) {
          whereClauses.push('sm.status = 1');
        } else if (Number(status) === 2) {
          whereClauses.push('(sm.status = 2 OR sm.status = 0)');
        }
      }
      if (isValidVal(search)) {
        const rawSearch = String(search).trim();
        const searchParam = `%${rawSearch}%`;
        const words = rawSearch.split(/\s+/).filter(Boolean);

        const conditions = [
          'sm.title LIKE ?',
          'sm.description LIKE ?',
          'sm.chapter LIKE ?',
          'sub.subject_name LIKE ?',
          'cm.class_name LIKE ?',
          'mt.material_type_name LIKE ?',
          'aym.academic_year LIKE ?',
        ];
        const searchParams = [searchParam, searchParam, searchParam, searchParam, searchParam, searchParam, searchParam];

        if (words.length > 1) {
          const wordConditions = words.map(() => `(
            sm.title LIKE ? OR 
            sm.description LIKE ? OR 
            sm.chapter LIKE ? OR 
            sub.subject_name LIKE ? OR 
            cm.class_name LIKE ? OR 
            mt.material_type_name LIKE ? OR
            aym.academic_year LIKE ?
          )`);
          const wordParams = [];
          words.forEach((w) => {
            const wp = `%${w}%`;
            wordParams.push(wp, wp, wp, wp, wp, wp, wp);
          });
          whereClauses.push(`((${conditions.join(' OR ')}) OR (${wordConditions.join(' AND ')}))`);
          params.push(...searchParams, ...wordParams);
        } else {
          whereClauses.push(`(${conditions.join(' OR ')})`);
          params.push(...searchParams);
        }
      }

      const whereString = `WHERE ${whereClauses.join(' AND ')}`;

      const baseFrom = `
        FROM study_materials sm
        LEFT JOIN class_master cm ON cm.id = sm.class_id
        LEFT JOIN section_master sec ON sec.id = sm.section_id
        LEFT JOIN subject_master sub ON sub.id = sm.subject_id
        LEFT JOIN material_types mt ON mt.id = sm.material_type_id
        LEFT JOIN academic_year_master aym ON aym.id = sm.academic_year_id
        LEFT JOIN branch_master bm ON bm.id = COALESCE(sm.branch_id, cm.branch_id)
        LEFT JOIN user_master um ON um.id = sm.uploaded_by AND (sm.uploader_type = 'admin' OR sm.uploader_type = 'super_admin')
        LEFT JOIN teacher_master tm ON tm.id = sm.uploaded_by AND sm.uploader_type = 'teacher'
        ${whereString}
      `;

      const countSql = `SELECT COUNT(*) AS total ${baseFrom}`;
      const [countRows] = await pool.query(countSql, params);
      const total = countRows[0]?.total || 0;

      const numLimit = Math.max(1, Number(limit) || 10);
      const numPage = Math.max(1, Number(page) || 1);
      const offset = (numPage - 1) * numLimit;

      const dataSql = `
        SELECT 
          sm.*,
          COALESCE(sm.branch_id, cm.branch_id) AS branch_id,
          cm.class_name,
          sec.section_name,
          sub.subject_name,
          mt.material_type_name,
          aym.academic_year AS academic_year_code,
          bm.branch_name,
          bm.branch_code,
          CASE
            WHEN sm.uploader_type = 'admin' OR sm.uploader_type = 'super_admin'
            THEN NULLIF(TRIM(CONCAT(IFNULL(um.first_name, ''), ' ', IFNULL(um.last_name, ''))), '')
            WHEN sm.uploader_type = 'teacher'
            THEN NULLIF(TRIM(CONCAT(IFNULL(tm.first_name, ''), ' ', IFNULL(tm.last_name, ''))), '')
            ELSE NULL
          END AS uploaded_by_name
        ${baseFrom}
        ORDER BY sm.id DESC
        LIMIT ? OFFSET ?
      `;
      const [rows] = await pool.query(dataSql, [...params, numLimit, offset]);

      return {
        study_materials: rows || [],
        total,
        page: numPage,
        limit: numLimit,
        totalPages: Math.ceil(total / numLimit) || 1,
      };
    } catch (e) {
      console.error('Error in getStudyMaterials:', e.message);
      return {
        study_materials: [],
        total: 0,
        page: 1,
        limit: 10,
        totalPages: 1,
      };
    }
  }

  static async getStudyMaterialById(id, schoolId, branchId = null) {
    try {
      const effectiveBranchId = AcademicModel.parseBranchId(branchId);
      let sql = `SELECT sm.*, COALESCE(sm.branch_id, cm.branch_id) AS branch_id, cm.class_name, sec.section_name, sub.subject_name, mt.material_type_name, aym.academic_year AS academic_year_code, bm.branch_name, bm.branch_code,
         CASE
           WHEN sm.uploader_type = 'admin' OR sm.uploader_type = 'super_admin'
           THEN NULLIF(TRIM(CONCAT(IFNULL(um.first_name, ''), ' ', IFNULL(um.last_name, ''))), '')
           WHEN sm.uploader_type = 'teacher'
           THEN NULLIF(TRIM(CONCAT(IFNULL(tm.first_name, ''), ' ', IFNULL(tm.last_name, ''))), '')
           ELSE NULL
         END AS uploaded_by_name
         FROM study_materials sm
         LEFT JOIN class_master cm ON cm.id = sm.class_id
         LEFT JOIN section_master sec ON sec.id = sm.section_id
         LEFT JOIN subject_master sub ON sub.id = sm.subject_id
         LEFT JOIN material_types mt ON mt.id = sm.material_type_id
         LEFT JOIN academic_year_master aym ON aym.id = sm.academic_year_id
         LEFT JOIN branch_master bm ON bm.id = COALESCE(sm.branch_id, cm.branch_id)
         LEFT JOIN user_master um ON um.id = sm.uploaded_by AND (sm.uploader_type = 'admin' OR sm.uploader_type = 'super_admin')
         LEFT JOIN teacher_master tm ON tm.id = sm.uploaded_by AND sm.uploader_type = 'teacher'
         WHERE sm.id = ? AND sm.school_id = ? AND (sm.status != 4 OR sm.status IS NULL)`;
      const params = [id, schoolId];
      if (effectiveBranchId) {
        sql += ` AND COALESCE(sm.branch_id, cm.branch_id) = ?`;
        params.push(effectiveBranchId);
      }
      sql += ` LIMIT 1`;
      const [rows] = await pool.query(sql, params);
      return rows[0] || null;
    } catch (e) {
      console.error('Error in getStudyMaterialById:', e.message);
      return null;
    }
  }

  static async createStudyMaterial(schoolId, data, userId) {
    const {
      branch_id,
      branchId,
      uploader_type,
      academic_year_id,
      class_id,
      section_id,
      subject_id,
      material_type_id,
      title,
      chapter = '',
      description = '',
      attachment = '',
      attachment_original_name = '',
      attachment_size = 0,
      attachment_extension = '',
      publish_date = null,
      expiry_date = null,
      allow_download = 1,
      display_order = 0,
      status = 1,
    } = data;

    let resolvedBranchId = AcademicModel.parseBranchId(branch_id ?? branchId);
    if (!resolvedBranchId && class_id) {
      const [cm] = await pool.query(`SELECT branch_id FROM class_master WHERE id = ? AND school_id = ? LIMIT 1`, [class_id, schoolId]);
      if (cm.length && cm[0].branch_id) resolvedBranchId = Number(cm[0].branch_id);
    }
    if (!resolvedBranchId) {
      resolvedBranchId = await AcademicModel.resolveDefaultBranchId(schoolId);
    }

    let resolvedAcademicYearId = academic_year_id || null;
    if (!resolvedAcademicYearId) {
      const [ayRows] = await pool.query(
        `SELECT id FROM academic_year_master WHERE school_id = ? AND (branch_id = ? OR branch_id IS NULL) AND (status != 4 OR status IS NULL) ORDER BY is_current DESC, id DESC LIMIT 1`,
        [schoolId, resolvedBranchId]
      );
      if (ayRows && ayRows.length > 0) {
        resolvedAcademicYearId = ayRows[0].id;
      }
    }

    const teacherIdForValidation = uploader_type === 'teacher' ? userId : null;
    resolvedBranchId = await AcademicModel.validateStudyMaterialRelations(
      schoolId,
      resolvedBranchId,
      {
        academic_year_id: resolvedAcademicYearId,
        class_id,
        section_id,
        subject_id,
        material_type_id,
        title,
      },
      teacherIdForValidation,
      null
    );

    const formattedPublishDate = publish_date || new Date().toISOString().slice(0, 10);

    const [result] = await pool.query(
      `INSERT INTO study_materials (
        school_id, branch_id, academic_year_id, class_id, section_id, subject_id, material_type_id,
        title, chapter, description, attachment, attachment_original_name, attachment_size,
        attachment_extension, publish_date, expiry_date, allow_download, display_order, status,
        uploaded_by, uploader_type, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
      [
        schoolId,
        resolvedBranchId,
        resolvedAcademicYearId,
        class_id,
        section_id && Number(section_id) > 0 ? Number(section_id) : null,
        subject_id,
        material_type_id || null,
        String(title).trim(),
        chapter || null,
        description || null,
        attachment || null,
        attachment_original_name || null,
        attachment_size || null,
        attachment_extension || null,
        formattedPublishDate,
        expiry_date || null,
        allow_download !== undefined ? allow_download : 1,
        display_order || 0,
        status !== undefined ? Number(status) : 1,
        userId || null,
        uploader_type || null,
      ]
    );
    return result.insertId;
  }

  static async updateStudyMaterial(id, schoolId, data, branchId = null, teacherId = null) {
    const cleanBranchId = AcademicModel.parseBranchId(branchId);
    const existing = await AcademicModel.getStudyMaterialById(id, schoolId, cleanBranchId);
    if (!existing) {
      return false;
    }

    if (teacherId) {
      if (existing.uploader_type !== 'teacher' || Number(existing.uploaded_by) !== Number(teacherId)) {
        const err = new Error('You are only authorized to update study materials uploaded by yourself.');
        err.statusCode = 403;
        throw err;
      }
    }

    const {
      academic_year_id,
      class_id,
      section_id,
      subject_id,
      material_type_id,
      title,
      chapter,
      description,
      attachment,
      attachment_original_name,
      attachment_size,
      attachment_extension,
      publish_date,
      expiry_date,
      allow_download,
      display_order,
      status,
    } = data;

    const mergedAcademicYearId = academic_year_id !== undefined ? academic_year_id : existing.academic_year_id;
    const mergedClassId = class_id !== undefined ? class_id : existing.class_id;
    const mergedSectionId = section_id !== undefined ? (section_id || null) : existing.section_id;
    const mergedSubjectId = subject_id !== undefined ? subject_id : existing.subject_id;
    const mergedMaterialTypeId = material_type_id !== undefined ? material_type_id : existing.material_type_id;
    const mergedTitle = title !== undefined ? String(title).trim() : existing.title;
    const targetBranchId = cleanBranchId || AcademicModel.parseBranchId(existing.branch_id);

    await AcademicModel.validateStudyMaterialRelations(
      schoolId,
      targetBranchId,
      {
        academic_year_id: mergedAcademicYearId,
        class_id: mergedClassId,
        section_id: mergedSectionId,
        subject_id: mergedSubjectId,
        material_type_id: mergedMaterialTypeId,
        title: mergedTitle,
      },
      teacherId,
      id
    );

    let sql = `UPDATE study_materials 
       SET branch_id = COALESCE(?, branch_id),
           academic_year_id = COALESCE(?, academic_year_id),
           class_id = COALESCE(?, class_id),
           section_id = ?,
           subject_id = COALESCE(?, subject_id),
           material_type_id = COALESCE(?, material_type_id),
           title = COALESCE(?, title),
           chapter = COALESCE(?, chapter),
           description = COALESCE(?, description),
           attachment = COALESCE(?, attachment),
           attachment_original_name = COALESCE(?, attachment_original_name),
           attachment_size = COALESCE(?, attachment_size),
           attachment_extension = COALESCE(?, attachment_extension),
           publish_date = COALESCE(?, publish_date),
           expiry_date = COALESCE(?, expiry_date),
           allow_download = COALESCE(?, allow_download),
           display_order = COALESCE(?, display_order),
           status = COALESCE(?, status)
       WHERE id = ? AND school_id = ?`;
    const params = [
      targetBranchId || null,
      academic_year_id || null,
      class_id || null,
      mergedSectionId && Number(mergedSectionId) > 0 ? Number(mergedSectionId) : null,
      subject_id || null,
      material_type_id || null,
      title ? String(title).trim() : null,
      chapter !== undefined ? chapter : null,
      description !== undefined ? description : null,
      attachment !== undefined ? attachment : null,
      attachment_original_name !== undefined ? attachment_original_name : null,
      attachment_size !== undefined ? attachment_size : null,
      attachment_extension !== undefined ? attachment_extension : null,
      publish_date !== undefined ? publish_date : null,
      expiry_date !== undefined ? expiry_date : null,
      allow_download !== undefined ? allow_download : null,
      display_order !== undefined ? display_order : null,
      status !== undefined ? status : null,
      id,
      schoolId,
    ];
    if (cleanBranchId) {
      sql += ` AND branch_id = ?`;
      params.push(cleanBranchId);
    }
    const [result] = await pool.query(sql, params);
    if (result.affectedRows > 0 && attachment && existing.attachment && attachment !== existing.attachment) {
      const { hardDeleteFile } = require('../utils/file.util');
      await hardDeleteFile(existing.attachment, { schoolId });
    }
    return result.affectedRows > 0;
  }

  static async toggleStudyMaterialStatus(id, schoolId, branchId = null, teacherId = null) {
    const cleanBranchId = AcademicModel.parseBranchId(branchId);
    let selectSql = `SELECT id, status, uploaded_by, uploader_type FROM study_materials WHERE id = ? AND school_id = ? AND (status != 4 OR status IS NULL)`;
    const selectParams = [id, schoolId];
    if (cleanBranchId) {
      selectSql += ` AND branch_id = ?`;
      selectParams.push(cleanBranchId);
    }
    selectSql += ` LIMIT 1`;
    const [rows] = await pool.query(selectSql, selectParams);
    if (rows.length === 0) return null;

    if (teacherId) {
      if (rows[0].uploader_type !== 'teacher' || Number(rows[0].uploaded_by) !== Number(teacherId)) {
        const err = new Error('You are only authorized to change the status of study materials uploaded by yourself.');
        err.statusCode = 403;
        throw err;
      }
    }

    const newStatus = Number(rows[0].status) === 1 ? 2 : 1;
    let updateSql = `UPDATE study_materials SET status = ? WHERE id = ? AND school_id = ?`;
    const updateParams = [newStatus, id, schoolId];
    if (cleanBranchId) {
      updateSql += ` AND branch_id = ?`;
      updateParams.push(cleanBranchId);
    }
    await pool.query(updateSql, updateParams);
    return newStatus;
  }

  static async deleteStudyMaterial(id, schoolId, branchId = null, teacherId = null) {
    const cleanBranchId = AcademicModel.parseBranchId(branchId);
    let selectSql = `SELECT id, attachment, uploaded_by, uploader_type FROM study_materials WHERE id = ? AND school_id = ? AND (status != 4 OR status IS NULL)`;
    const selectParams = [id, schoolId];
    if (cleanBranchId) {
      selectSql += ` AND branch_id = ?`;
      selectParams.push(cleanBranchId);
    }
    selectSql += ` LIMIT 1`;
    const [rows] = await pool.query(selectSql, selectParams);
    if (!rows || rows.length === 0) return false;

    if (teacherId) {
      if (rows[0].uploader_type !== 'teacher' || Number(rows[0].uploaded_by) !== Number(teacherId)) {
        const err = new Error('You are only authorized to delete study materials uploaded by yourself.');
        err.statusCode = 403;
        throw err;
      }
    }

    let sql = `UPDATE study_materials SET status = 4 WHERE id = ? AND school_id = ?`;
    const params = [id, schoolId];
    if (cleanBranchId) {
      sql += ` AND branch_id = ?`;
      params.push(cleanBranchId);
    }
    const [result] = await pool.query(sql, params);
    if (result.affectedRows > 0 && rows[0].attachment) {
      const { hardDeleteFile } = require('../utils/file.util');
      await hardDeleteFile(rows[0].attachment, { schoolId });
    }
    return result.affectedRows > 0;
  }
}

module.exports = AcademicModel;
