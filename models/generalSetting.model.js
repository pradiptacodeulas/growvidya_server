const { pool } = require('../config/db.config');

class GeneralSettingModel {
  /**
   * Fetches lightweight public school configuration & branding
   */
  static async getSchoolConfig(schoolId = 1) {
    const targetId = schoolId;
    const [schools] = await pool.query(
      `SELECT 
        id, 
        school_name AS school_title, 
        school_code, 
        school_logo, 
        address, 
        city, 
        state, 
        country, 
        postal_code, 
        phone_number AS phone, 
        email, 
        website, 
        established_year, 
        school_type, 
        affiliation_board, 
        footer, 
        status
       FROM school_master 
       WHERE id = ?`,
      [targetId]
    );

    const school = schools[0] || {};
    return {
      id: school.id || null,
      school_title: school.school_title || '',
      school_name: school.school_title || '',
      school_logo: school.school_logo || '',
      footer: school.footer || '',
      phone: school.phone || '',
      email: school.email || '',
      website: school.website || '',
      address: school.address || '',
    };
  }

  /**
   * Fetches the general settings / school configuration for the logged in school
   */
  static async getSchoolSettings(schoolId = 1) {
    const targetId = schoolId;
    const [schools] = await pool.query(
      `SELECT 
        id, 
        school_name AS school_title, 
        school_code, 
        school_logo, 
        address, 
        city, 
        state, 
        country, 
        postal_code, 
        phone_number AS phone, 
        email, 
        website, 
        established_year, 
        school_type, 
        affiliation_board, 
        footer, 
        status
       FROM school_master 
       WHERE id = ?`,
      [targetId]
    );

    const school = schools[0] || {};

    // Fetch weekends for this school
    const [weekendRows] = await pool.query(
      `SELECT weekends FROM weekends WHERE school_id = ?`,
      [schoolId]
    );
    const weekends = weekendRows.map((w) => Number(w.weekends));

    // Fetch countries
    const [countries] = await pool.query(
      `SELECT id, name, name AS country, name AS country_name, shortname, phonecode FROM countries WHERE status = 1 OR status IS NULL ORDER BY name ASC`
    );

    // Fetch states if country is set
    let states = [];
    if (school.country) {
      const [stateRows] = await pool.query(
        `SELECT id_state AS id, state AS name FROM states WHERE country_id = ? AND is_active = 1 ORDER BY state ASC`,
        [school.country]
      );
      states = stateRows;
    }

    // Fetch cities if state is set
    let cities = [];
    if (school.state) {
      const [cityRows] = await pool.query(
        `SELECT id, name FROM cities WHERE state_id = ? ORDER BY name ASC`,
        [school.state]
      );
      cities = cityRows;
    }

    return {
      school,
      weekends,
      countries,
      states,
      cities,
    };
  }

  /**
   * Get states by country ID
   */
  static async getStatesByCountry(countryId) {
    const [states] = await pool.query(
      `SELECT id_state AS id, state AS name FROM states WHERE country_id = ? AND is_active = 1 ORDER BY state ASC`,
      [countryId]
    );
    return states;
  }

  /**
   * Get cities by state ID
   */
  static async getCitiesByState(stateId) {
    const [cities] = await pool.query(
      `SELECT id, name FROM cities WHERE state_id = ? ORDER BY name ASC`,
      [stateId]
    );
    return cities;
  }

  /**
   * Updates the school configuration and weekends
   */
  static async updateSchoolSettings(schoolId, data) {
    const {
      school_title,
      school_logo,
      phone,
      address,
      country,
      state,
      city,
      postal_code,
      footer,
      established_year,
      website,
      affiliation_board,
      weekends = [],
    } = data;

    // Update school_master
    await pool.query(
      `UPDATE school_master SET 
        school_name = COALESCE(?, school_name),
        school_logo = CASE WHEN ? IS NOT NULL THEN ? ELSE school_logo END,
        phone_number = COALESCE(?, phone_number),
        address = COALESCE(?, address),
        country = COALESCE(?, country),
        state = COALESCE(?, state),
        city = COALESCE(?, city),
        postal_code = COALESCE(?, postal_code),
        footer = COALESCE(?, footer),
        established_year = COALESCE(?, established_year),
        website = COALESCE(?, website),
        affiliation_board = COALESCE(?, affiliation_board),
        updated_at = NOW()
       WHERE id = ?`,
      [
        school_title,
        school_logo !== undefined ? school_logo : null,
        school_logo !== undefined ? school_logo : null,
        phone,
        address,
        country ? Number(country) : null,
        state ? Number(state) : null,
        city ? Number(city) : null,
        postal_code,
        footer,
        established_year,
        website,
        affiliation_board,
        schoolId,
      ]
    );

    // Update weekends
    if (Array.isArray(weekends)) {
      await pool.query(`DELETE FROM weekends WHERE school_id = ?`, [schoolId]);
      if (weekends.length > 0) {
        const weekendValues = weekends.map((w) => [schoolId, Number(w)]);
        await pool.query(
          `INSERT INTO weekends (school_id, weekends) VALUES ?`,
          [weekendValues]
        );
      }
    }

    const [updatedRows] = await pool.query(
      `SELECT id, school_name, school_code, school_logo, email, phone_number, website, footer FROM school_master WHERE id = ?`,
      [schoolId]
    );

    return updatedRows[0] || null;
  }
}

module.exports = GeneralSettingModel;
