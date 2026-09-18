const AdminFeesModel = require('../models/adminFees.model');
const ApiResponse = require('../utils/api.response');

class AdminFeesController {
  // =========================================================
  // 1. FEE COMPONENTS
  // =========================================================

  static async getAllComponents(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { status, search } = req.query;
      const components = await AdminFeesModel.getAllComponents({ schoolId, status, search });
      return ApiResponse.success(res, 'Fee components retrieved successfully.', { components });
    } catch (error) {
      next(error);
    }
  }

  static async getComponentById(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { id } = req.params;
      const component = await AdminFeesModel.getComponentById(id, schoolId);
      if (!component) {
        return ApiResponse.error(res, 'Fee component not found.', null, 404);
      }
      return ApiResponse.success(res, 'Fee component retrieved successfully.', component);
    } catch (error) {
      next(error);
    }
  }

  static async createComponent(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { name, code, tax_rate, taxRate, account_code, accountCode, description, status } = req.body;

      if (!name) {
        return ApiResponse.error(res, 'Component Name is required.', null, 400);
      }

      const id = await AdminFeesModel.createComponent({
        schoolId,
        name,
        code,
        taxRate: tax_rate || taxRate,
        accountCode: account_code || accountCode,
        description,
        status,
      });

      return ApiResponse.success(res, 'Fee component created successfully.', { id }, 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateComponent(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { id } = req.params;
      const { name, code, tax_rate, taxRate, account_code, accountCode, description, status } = req.body;

      const success = await AdminFeesModel.updateComponent(id, schoolId, {
        name,
        code,
        taxRate: tax_rate !== undefined ? tax_rate : taxRate,
        accountCode: account_code !== undefined ? account_code : accountCode,
        description,
        status,
      });

      if (!success) {
        return ApiResponse.error(res, 'Fee component not found or no changes made.', null, 404);
      }

      return ApiResponse.success(res, 'Fee component updated successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async deleteComponent(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { id } = req.params;
      const success = await AdminFeesModel.deleteComponent(id, schoolId);
      if (!success) {
        return ApiResponse.error(res, 'Fee component not found.', null, 404);
      }
      return ApiResponse.success(res, 'Fee component deleted successfully.');
    } catch (error) {
      next(error);
    }
  }

  // =========================================================
  // 2. FEE STRUCTURES
  // =========================================================

  static async getAllStructures(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const branchId = req.branchId || req.query.branch_id || null;
      const { academic_year_id, status, search } = req.query;
      const structures = await AdminFeesModel.getAllStructures({
        schoolId,
        branchId,
        academicYearId: academic_year_id,
        status,
        search,
      });
      return ApiResponse.success(res, 'Fee structures retrieved successfully.', { structures });
    } catch (error) {
      next(error);
    }
  }

  static async getStructureById(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { id } = req.params;
      const structure = await AdminFeesModel.getStructureById(id, schoolId);
      if (!structure) {
        return ApiResponse.error(res, 'Fee structure not found.', null, 404);
      }
      return ApiResponse.success(res, 'Fee structure retrieved successfully.', structure);
    } catch (error) {
      next(error);
    }
  }

  static async saveStructure(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const branchId = req.body?.branch_id || req.branchId || req.query.branch_id || null;
      const {
        id,
        name,
        class_id,
        classIds,
        section_id,
        sectionId,
        academic_year_id,
        academicYearId,
        frequency,
        due_day,
        dueDay,
        grace_period_days,
        gracePeriodDays,
        late_fee_type,
        lateFeeType,
        late_fee_amount,
        lateFeeAmount,
        allow_partial_payment,
        allowPartialPayment,
        is_published,
        isPublished,
        generate_on_day,
        generateOnDay,
        description,
        status,
        components,
        auto_allocate,
        autoAllocate,
      } = req.body;

      if (!name) {
        return ApiResponse.error(res, 'Structure Name is required.', null, 400);
      }

      const targetStructureId = id || req.params?.id;
      if (targetStructureId) {
        const existingStructure = await AdminFeesModel.getStructureById(targetStructureId, schoolId);
        if (existingStructure && Number(existingStructure.is_published) === 1) {
          const reqPublished = is_published !== undefined ? is_published : isPublished;
          if (
            reqPublished !== undefined &&
            (reqPublished === 0 || reqPublished === '0' || reqPublished === false)
          ) {
            return ApiResponse.error(
              res,
              'A published fee structure cannot be reverted to Draft. A published Fee Structure must remain published.',
              null,
              400
            );
          }
        }
      }

      const shouldAutoAllocate = auto_allocate !== undefined 
        ? (auto_allocate === true || auto_allocate === 1 || auto_allocate === 'true' || auto_allocate === '1')
        : (autoAllocate !== undefined 
            ? (autoAllocate === true || autoAllocate === 1 || autoAllocate === 'true' || autoAllocate === '1')
            : true);

      const { id: structureId, allocatedCount } = await AdminFeesModel.saveStructure({
        id: targetStructureId,
        schoolId,
        branchId,
        name,
        classIds: class_id !== undefined ? class_id : classIds,
        sectionId: section_id !== undefined ? section_id : sectionId,
        academicYearId: academic_year_id !== undefined ? academic_year_id : academicYearId,
        frequency,
        dueDay: due_day !== undefined ? due_day : dueDay,
        gracePeriodDays: grace_period_days !== undefined ? grace_period_days : gracePeriodDays,
        lateFeeType: late_fee_type !== undefined ? late_fee_type : lateFeeType,
        lateFeeAmount: late_fee_amount !== undefined ? late_fee_amount : lateFeeAmount,
        allowPartialPayment: allow_partial_payment !== undefined ? allow_partial_payment : allowPartialPayment,
        isPublished: is_published !== undefined ? is_published : isPublished,
        generateOnDay: generate_on_day !== undefined ? generate_on_day : generateOnDay,
        description,
        status,
        components,
        autoAllocate: shouldAutoAllocate,
      });

      let message = targetStructureId
        ? 'Fee structure updated successfully.'
        : 'Fee structure created successfully.';

      if (allocatedCount > 0) {
        message = `Fee structure saved and automatically assigned to ${allocatedCount} student${allocatedCount === 1 ? '' : 's'}.`;
      }

      return ApiResponse.success(res, message, { id: structureId, allocatedCount });
    } catch (error) {
      next(error);
    }
  }

  static async deleteStructure(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { id } = req.params;
      const success = await AdminFeesModel.deleteStructure(id, schoolId);
      if (!success) {
        return ApiResponse.error(res, 'Fee structure not found.', null, 404);
      }
      return ApiResponse.success(res, 'Fee structure deleted successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async togglePublishStructure(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { id } = req.params;
      const { is_published } = req.body;

      if (!id) {
        return ApiResponse.error(res, 'Structure ID is required.', null, 400);
      }

      const existingStructure = await AdminFeesModel.getStructureById(id, schoolId);
      if (!existingStructure) {
        return ApiResponse.error(res, 'Fee structure not found.', null, 404);
      }

      if (Number(existingStructure.is_published) === 1) {
        const isTryingToUnpublish =
          is_published === 0 ||
          is_published === '0' ||
          is_published === false ||
          is_published === null ||
          is_published === undefined;
        if (isTryingToUnpublish) {
          return ApiResponse.error(
            res,
            'A published fee structure cannot be reverted to Draft. A published Fee Structure must remain published.',
            null,
            400
          );
        }
      }

      const updated = await AdminFeesModel.togglePublishStructure(id, schoolId, is_published);
      if (!updated) {
        return ApiResponse.error(res, 'Fee structure not found.', null, 404);
      }

      const statusText = updated.is_published === 1 ? 'Published' : 'Draft';
      let message = `Fee structure "${updated.name}" is now ${statusText}.`;
      if (updated.allocatedCount > 0) {
        message += ` Automatically assigned to ${updated.allocatedCount} student${updated.allocatedCount === 1 ? '' : 's'}.`;
      }

      return ApiResponse.success(res, message, updated);
    } catch (error) {
      next(error);
    }
  }

  // =========================================================
  // 3. STUDENT FEE ALLOCATIONS
  // =========================================================

  static async getAllocations(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const branchId = req.branchId || req.query.branch_id || null;
      const { class_id, section_id, structure_id, academic_year_id, search, page, limit } = req.query;
      const result = await AdminFeesModel.getAllocations({
        schoolId,
        branchId,
        classId: class_id,
        sectionId: section_id,
        structureId: structure_id,
        academicYearId: academic_year_id,
        search,
        page,
        limit,
      });
      return ApiResponse.success(res, 'Student fee allocations retrieved successfully.', {
        allocations: result.allocations,
        pagination: {
          total: result.total,
          page: result.page,
          limit: result.limit,
          totalPages: result.totalPages,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async allocateStructureToStudents(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const {
        academic_year_id,
        academicYearId,
        fee_structure_id,
        feeStructureId,
        student_ids,
        studentIds,
        allow_partial_payment,
        allowPartialPayment,
      } = req.body;

      const targetStructureId = fee_structure_id || feeStructureId;
      const targetYearId = academic_year_id || academicYearId;
      const targetStudentIds = student_ids || studentIds;

      if (!targetStructureId || !Array.isArray(targetStudentIds) || targetStudentIds.length === 0) {
        return ApiResponse.error(res, 'Fee Structure and target students are required.', null, 400);
      }

      const count = await AdminFeesModel.allocateStructureToStudents({
        schoolId,
        academicYearId: targetYearId,
        feeStructureId: targetStructureId,
        studentIds: targetStudentIds,
        allowPartialPayment: allow_partial_payment !== undefined ? allow_partial_payment : allowPartialPayment,
      });

      return ApiResponse.success(res, `Fee structure assigned to ${count} student(s) successfully.`, { count });
    } catch (error) {
      next(error);
    }
  }

  static async deleteAllocation(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { id } = req.params;
      const success = await AdminFeesModel.deleteAllocation(id, schoolId);
      if (!success) {
        return ApiResponse.error(res, 'Allocation not found.', null, 404);
      }
      return ApiResponse.success(res, 'Student fee allocation removed successfully.');
    } catch (error) {
      next(error);
    }
  }

  // =========================================================
  // 4. FEE INVOICES & GENERATION
  // =========================================================

  static async getAllInvoices(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const branchId = req.branchId || req.query.branch_id || null;
      const {
        class_id,
        section_id,
        structure_id,
        academic_year_id,
        status,
        student_id,
        search,
        page,
        limit,
      } = req.query;

      const result = await AdminFeesModel.getAllInvoices({
        schoolId,
        branchId,
        classId: class_id,
        sectionId: section_id,
        structureId: structure_id,
        academicYearId: academic_year_id,
        status,
        studentId: student_id,
        search,
        page,
        limit,
      });

      return ApiResponse.success(res, 'Fee invoices retrieved successfully.', {
        invoices: result.invoices,
        pagination: {
          total: result.total,
          page: result.page,
          limit: result.limit,
          totalPages: result.totalPages,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async getInvoiceById(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { id } = req.params;
      const invoice = await AdminFeesModel.getInvoiceById(id, schoolId);
      if (!invoice) {
        return ApiResponse.error(res, 'Fee invoice not found.', null, 404);
      }
      return ApiResponse.success(res, 'Fee invoice retrieved successfully.', invoice);
    } catch (error) {
      next(error);
    }
  }

  static async generateInvoices(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const branchId = req.body?.branch_id || req.branchId || req.query.branch_id || null;
      const {
        academic_year_id,
        academicYearId,
        class_id,
        classId,
        section_id,
        sectionId,
        student_id,
        studentId,
        fee_structure_id,
        feeStructureId,
        title,
        issue_date,
        issueDate,
        due_date,
        dueDate,
      } = req.body;

      const targetStructureId = fee_structure_id || feeStructureId;
      if (!targetStructureId) {
        return ApiResponse.error(res, 'Fee Structure is required.', null, 400);
      }

      const count = await AdminFeesModel.generateInvoices({
        schoolId,
        branchId,
        academicYearId: academic_year_id || academicYearId,
        classId: class_id || classId,
        sectionId: section_id || sectionId,
        studentId: student_id || studentId,
        feeStructureId: targetStructureId,
        title,
        issueDate: issue_date || issueDate,
        dueDate: due_date || dueDate,
      });

      return ApiResponse.success(res, `Successfully generated ${count} invoice(s).`, { count }, 201);
    } catch (error) {
      if (
        error.message &&
        (error.message.includes('Draft mode') ||
          error.message.includes('published') ||
          error.message.includes('not found') ||
          error.message.includes('deleted') ||
          error.message.includes('eligible students'))
      ) {
        return ApiResponse.error(res, error.message, null, 400);
      }
      next(error);
    }
  }

  static async deleteInvoice(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { id } = req.params;
      const success = await AdminFeesModel.deleteInvoice(id, schoolId);
      if (!success) {
        return ApiResponse.error(res, 'Invoice not found.', null, 404);
      }
      return ApiResponse.success(res, 'Fee invoice deleted successfully.');
    } catch (error) {
      next(error);
    }
  }

  // =========================================================
  // 5. FEE PAYMENTS & COLLECTION STATS
  // =========================================================

  static async getCollectionStats(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const branchId = req.branchId || req.query.branch_id || null;
      const stats = await AdminFeesModel.getCollectionStats(schoolId, branchId);
      return ApiResponse.success(res, 'Collection statistics retrieved successfully.', stats);
    } catch (error) {
      next(error);
    }
  }

  static async getAllPayments(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const branchId = req.branchId || req.query.branch_id || null;
      const { student_id, invoice_id, payment_method, date_from, date_to, search } = req.query;

      const payments = await AdminFeesModel.getAllPayments({
        schoolId,
        branchId,
        studentId: student_id,
        invoiceId: invoice_id,
        paymentMethod: payment_method,
        dateFrom: date_from,
        dateTo: date_to,
        search,
      });

      return ApiResponse.success(res, 'Fee payments retrieved successfully.', { payments });
    } catch (error) {
      next(error);
    }
  }

  static async getPaymentById(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { id } = req.params;
      const payment = await AdminFeesModel.getPaymentById(id, schoolId);
      if (!payment) {
        return ApiResponse.error(res, 'Payment record not found.', null, 404);
      }
      return ApiResponse.success(res, 'Payment record retrieved successfully.', payment);
    } catch (error) {
      next(error);
    }
  }

  static async recordPayment(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const collectedBy = req.user.id;
      const branchId = req.body?.branch_id || req.branchId || req.query.branch_id || null;
      const {
        student_id,
        studentId,
        invoice_id,
        invoiceId,
        amount_paid,
        amountPaid,
        payment_method,
        paymentMethod,
        payment_date,
        paymentDate,
        reference_no,
        referenceNo,
        bank_name,
        bankName,
        late_fee_paid,
        lateFeePaid,
        notes,
      } = req.body;

      const targetInvoiceId = invoice_id || invoiceId;
      const targetAmount = amount_paid !== undefined ? amount_paid : amountPaid;

      if (!targetInvoiceId || parseFloat(targetAmount) <= 0) {
        return ApiResponse.error(res, 'Invoice ID and positive payment amount are required.', null, 400);
      }

      const result = await AdminFeesModel.recordPayment({
        schoolId,
        branchId,
        studentId: student_id || studentId,
        invoiceId: targetInvoiceId,
        amountPaid: targetAmount,
        paymentMethod: payment_method || paymentMethod,
        paymentDate: payment_date || paymentDate,
        referenceNo: reference_no || referenceNo,
        bankName: bank_name || bankName,
        lateFeePaid: late_fee_paid || lateFeePaid,
        notes,
        collectedBy,
      });

      return ApiResponse.success(res, `Payment recorded successfully. Receipt No: ${result.receiptNo}`, result, 201);
    } catch (error) {
      next(error);
    }
  }
}

module.exports = AdminFeesController;
