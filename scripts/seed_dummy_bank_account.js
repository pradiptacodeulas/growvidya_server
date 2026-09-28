const { pool } = require('../config/db.config');

async function seedDummyBankAccount() {
  try {
    const insertQuery = `
      INSERT INTO bank_account_master (
        account_title,
        beneficiary_name,
        account_number,
        bank_name,
        branch_name,
        ifsc_code,
        account_type,
        upi_id,
        swift_code,
        instructions,
        is_default,
        status,
        created_at,
        updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())
    `;

    const values = [
      'GrowVidya Primary Operations',
      'GrowVidya EdTech Solutions Pvt Ltd',
      '50200012345678',
      'HDFC Bank',
      'Koramangala Branch, Bengaluru',
      'HDFC0000123',
      'Current',
      'growvidya@hdfcbank',
      'HDFCINBB',
      'Please mention your School Registration ID or Registered Email in the transaction remarks.',
      1,
      1,
    ];

    const [result] = await pool.query(insertQuery, values);
    console.log('Dummy bank account inserted successfully with ID:', result.insertId);

    const [rows] = await pool.query('SELECT * FROM bank_account_master WHERE id = ?', [result.insertId]);
    console.log('Inserted Record Details:');
    console.log(JSON.stringify(rows[0], null, 2));

    process.exit(0);
  } catch (error) {
    console.error('Error seeding dummy bank account:', error);
    process.exit(1);
  }
}

seedDummyBankAccount();
