const AdminIdCardModel = require('../models/adminIdCard.model');
const IdCardPdfService = require('../services/idCardPdf.service');
const ApiResponse = require('../utils/api.response');

class AdminIdCardController {
  /**
   * Generates and streams ID card PDF (Single or Batch)
   */
  static async downloadIdCardPdf(req, res, next) {
    try {
      const schoolId = req.user?.schoolId || req.user?.school_id;
      const params = { ...req.query, ...req.body, ...req.params };

      let type = String(params.type || 'student').toLowerCase().trim();
      if (type.includes('teacher') || type === '2') {
        type = 'teacher';
      } else if (type.includes('staff') || type === '3') {
        type = 'staff';
      } else {
        type = 'student';
      }

      // Parse candidate IDs
      let parsedIds = [];
      const singleId = params.candidateId || params.id || params.studentId || params.teacherId || params.staffId;
      const arrayIds = params.candidateIds || params.studentIds || params.teacherIds || params.staffIds;

      if (singleId) {
        parsedIds = [parseInt(singleId, 10)];
      } else if (Array.isArray(arrayIds)) {
        parsedIds = arrayIds.map((id) => parseInt(id, 10)).filter(Boolean);
      } else if (typeof arrayIds === 'string' && arrayIds.trim()) {
        parsedIds = arrayIds.split(',').map((id) => parseInt(id.trim(), 10)).filter(Boolean);
      }

      let cardData = [];

      if (type === 'student') {
        const classId = params.classId || params.class_id ? parseInt(params.classId || params.class_id, 10) : null;
        const sectionId = params.sectionId || params.section_id ? parseInt(params.sectionId || params.section_id, 10) : null;
        const academicYearId = params.academicYearId || params.academic_year_id ? parseInt(params.academicYearId || params.academic_year_id, 10) : null;

        cardData = await AdminIdCardModel.getStudentIdCardData({
          schoolId,
          studentIds: parsedIds,
          classId,
          sectionId,
          academicYearId,
        });
      } else if (type === 'teacher') {
        cardData = await AdminIdCardModel.getTeacherIdCardData({
          schoolId,
          teacherIds: parsedIds,
        });
      } else {
        // Staff
        const roleId = params.roleId || params.role ? parseInt(params.roleId || params.role, 10) : null;
        cardData = await AdminIdCardModel.getStaffIdCardData({
          schoolId,
          staffIds: parsedIds,
          roleId,
        });
      }

      if (!cardData || cardData.length === 0) {
        return ApiResponse.error(
          res,
          `No active ${type} records found to generate ID cards.`,
          null,
          404
        );
      }

      if (req.query.format === 'json') {
        return ApiResponse.success(res, 'ID card data retrieved successfully', cardData);
      }

      const pdfBuffer = await IdCardPdfService.generateIdCardPdfBuffer(type, cardData);

      let fileName = `ID_Cards_${type.toUpperCase()}.pdf`;
      if (cardData.length === 1 && cardData[0].candidate) {
        const c = cardData[0].candidate;
        const cName = `${c.first_name || ''}_${c.last_name || ''}`.trim().replace(/[^a-zA-Z0-9_-]/g, '_') || 'Member';
        fileName = `IDCard_${type}_${cName}_${c.id}.pdf`;
      } else {
        fileName = `IDCards_${type}_Batch_${cardData.length}_${new Date().toISOString().split('T')[0]}.pdf`;
      }

      res.setHeader('Content-Type', 'application/pdf');
      res.setHeader('Content-Disposition', `inline; filename="${fileName}"`);
      res.setHeader('Content-Length', pdfBuffer.length);
      return res.end(pdfBuffer);
    } catch (error) {
      console.error('ID Card PDF generation error:', error);
      next(error);
    }
  }
}

module.exports = AdminIdCardController;
