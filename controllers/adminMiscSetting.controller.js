const MiscSettingModel = require('../models/miscSetting.model');
const ApiResponse = require('../utils/api.response');

class AdminMiscSettingController {
  // ==================== RELIGION ====================

  static async getReligions(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { search = '', page = 1, limit = 10 } = req.query;
      const offset = (Number(page) - 1) * Number(limit);

      const result = await MiscSettingModel.getAllReligions(schoolId, {
        search,
        limit: Number(limit),
        offset,
      });

      return ApiResponse.success(res, 'Religions fetched successfully.', {
        religions: result.rows,
        pagination: {
          total: result.total,
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(result.total / Number(limit)) || 1,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async createReligion(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { religion, sort_order = 1, status = 1 } = req.body;

      if (!religion || !String(religion).trim()) {
        return ApiResponse.error(res, 'Religion name is required.', 400);
      }

      const newId = await MiscSettingModel.createReligion(schoolId, {
        religion: String(religion).trim(),
        sort_order,
        status,
      });

      return ApiResponse.success(res, 'Religion created successfully.', { id: newId }, 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateReligion(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { id } = req.params;
      const { religion, sort_order, status } = req.body;

      const existing = await MiscSettingModel.getReligionById(id, schoolId);
      if (!existing) {
        return ApiResponse.error(res, 'Religion not found.', 404);
      }

      await MiscSettingModel.updateReligion(id, schoolId, {
        religion: religion !== undefined ? String(religion).trim() : undefined,
        sort_order,
        status,
      });

      return ApiResponse.success(res, 'Religion updated successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async deleteReligion(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { id } = req.params;

      const existing = await MiscSettingModel.getReligionById(id, schoolId);
      if (!existing) {
        return ApiResponse.error(res, 'Religion not found.', 404);
      }

      await MiscSettingModel.deleteReligion(id, schoolId);
      return ApiResponse.success(res, 'Religion deleted successfully.');
    } catch (error) {
      next(error);
    }
  }

  // ==================== MOTHER TONGUE ====================

  static async getMotherTongues(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { search = '', page = 1, limit = 10 } = req.query;
      const offset = (Number(page) - 1) * Number(limit);

      const result = await MiscSettingModel.getAllMotherTongues(schoolId, {
        search,
        limit: Number(limit),
        offset,
      });

      return ApiResponse.success(res, 'Mother tongues fetched successfully.', {
        motherTongues: result.rows,
        pagination: {
          total: result.total,
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(result.total / Number(limit)) || 1,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async createMotherTongue(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { mother_tongue, sort_order = 1, status = 1 } = req.body;

      if (!mother_tongue || !String(mother_tongue).trim()) {
        return ApiResponse.error(res, 'Mother tongue name is required.', 400);
      }

      const newId = await MiscSettingModel.createMotherTongue(schoolId, {
        mother_tongue: String(mother_tongue).trim(),
        sort_order,
        status,
      });

      return ApiResponse.success(res, 'Mother tongue created successfully.', { id: newId }, 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateMotherTongue(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { id } = req.params;
      const { mother_tongue, sort_order, status } = req.body;

      const existing = await MiscSettingModel.getMotherTongueById(id, schoolId);
      if (!existing) {
        return ApiResponse.error(res, 'Mother tongue not found.', 404);
      }

      await MiscSettingModel.updateMotherTongue(id, schoolId, {
        mother_tongue: mother_tongue !== undefined ? String(mother_tongue).trim() : undefined,
        sort_order,
        status,
      });

      return ApiResponse.success(res, 'Mother tongue updated successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async deleteMotherTongue(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { id } = req.params;

      const existing = await MiscSettingModel.getMotherTongueById(id, schoolId);
      if (!existing) {
        return ApiResponse.error(res, 'Mother tongue not found.', 404);
      }

      await MiscSettingModel.deleteMotherTongue(id, schoolId);
      return ApiResponse.success(res, 'Mother tongue deleted successfully.');
    } catch (error) {
      next(error);
    }
  }

  // ==================== GENDER ====================

  static async getGenders(req, res, next) {
    try {
      const { search = '', page = 1, limit = 10 } = req.query;
      const offset = (Number(page) - 1) * Number(limit);

      const result = await MiscSettingModel.getAllGenders({
        search,
        limit: Number(limit),
        offset,
      });

      return ApiResponse.success(res, 'Genders fetched successfully.', {
        genders: result.rows,
        pagination: {
          total: result.total,
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(result.total / Number(limit)) || 1,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  // ==================== CATEGORY ====================

  static async getCategories(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { search = '', page = 1, limit = 10 } = req.query;
      const offset = (Number(page) - 1) * Number(limit);

      const result = await MiscSettingModel.getAllCategories(schoolId, {
        search,
        limit: Number(limit),
        offset,
      });

      return ApiResponse.success(res, 'Categories fetched successfully.', {
        categories: result.rows,
        pagination: {
          total: result.total,
          page: Number(page),
          limit: Number(limit),
          totalPages: Math.ceil(result.total / Number(limit)) || 1,
        },
      });
    } catch (error) {
      next(error);
    }
  }

  static async createCategory(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { category, sort_order = 1, status = 1 } = req.body;

      if (!category || !String(category).trim()) {
        return ApiResponse.error(res, 'Category name is required.', 400);
      }

      const newId = await MiscSettingModel.createCategory(schoolId, {
        category: String(category).trim(),
        sort_order,
        status,
      });

      return ApiResponse.success(res, 'Category created successfully.', { id: newId }, 201);
    } catch (error) {
      next(error);
    }
  }

  static async updateCategory(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { id } = req.params;
      const { category, sort_order, status } = req.body;

      const existing = await MiscSettingModel.getCategoryById(id, schoolId);
      if (!existing) {
        return ApiResponse.error(res, 'Category not found.', 404);
      }

      await MiscSettingModel.updateCategory(id, schoolId, {
        category: category !== undefined ? String(category).trim() : undefined,
        sort_order,
        status,
      });

      return ApiResponse.success(res, 'Category updated successfully.');
    } catch (error) {
      next(error);
    }
  }

  static async deleteCategory(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const { id } = req.params;

      const existing = await MiscSettingModel.getCategoryById(id, schoolId);
      if (!existing) {
        return ApiResponse.error(res, 'Category not found.', 404);
      }

      await MiscSettingModel.deleteCategory(id, schoolId);
      return ApiResponse.success(res, 'Category deleted successfully.');
    } catch (error) {
      next(error);
    }
  }
}

module.exports = AdminMiscSettingController;
