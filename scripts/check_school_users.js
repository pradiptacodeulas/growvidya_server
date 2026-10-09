const { pool } = require('../config/db.config');

async function checkUsers() {
  const [users] = await pool.query(
    'SELECT u.id, u.school_id, u.branch_id, u.admin_type, u.first_name, u.last_name, u.email, u.phone, rm.role_name ' +
    'FROM user_master u ' +
    'LEFT JOIN role_master rm ON u.admin_type = rm.id ' +
    'WHERE u.school_id = 1'
  );
  console.log('Users in School 1:');
  console.table(users);
  await pool.end();
}

checkUsers();
