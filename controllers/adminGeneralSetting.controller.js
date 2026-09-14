const GeneralSettingModel = require('../models/generalSetting.model');
const ApiResponse = require('../utils/api.response');

class AdminGeneralSettingController {
  static async getGeneralSettings(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const settings = await GeneralSettingModel.getSchoolSettings(schoolId);
      return ApiResponse.success(res, 'General settings fetched successfully.', settings);
    } catch (error) {
      next(error);
    }
  }

  static async getStatesByCountry(req, res, next) {
    try {
      const { countryId } = req.params;
      const states = await GeneralSettingModel.getStatesByCountry(countryId);
      return ApiResponse.success(res, 'States fetched successfully.', states);
    } catch (error) {
      next(error);
    }
  }

  static async getCitiesByState(req, res, next) {
    try {
      const { stateId } = req.params;
      const cities = await GeneralSettingModel.getCitiesByState(stateId);
      return ApiResponse.success(res, 'Cities fetched successfully.', cities);
    } catch (error) {
      next(error);
    }
  }

  static async updateGeneralSettings(req, res, next) {
    try {
      const schoolId = req.user.schoolId;
      const data = req.body;

      const updatedSchool = await GeneralSettingModel.updateSchoolSettings(schoolId, data);
      return ApiResponse.success(res, 'General settings updated successfully.', {
        schoolLogo: updatedSchool?.school_logo || data.school_logo,
        schoolName: updatedSchool?.school_name || data.school_title,
        footer: updatedSchool?.footer !== undefined ? updatedSchool.footer : data.footer,
        school: updatedSchool,
      });
    } catch (error) {
      next(error);
    }
  }
}

module.exports = AdminGeneralSettingController;
