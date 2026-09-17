const mysql = require('mysql2/promise');
const config = require('./app.config');

const pool = mysql.createPool({
  host: config.db.host,
  port: config.db.port,
  user: config.db.user,
  password: config.db.password,
  database: config.db.database,
  waitForConnections: true,
  connectionLimit: process.env.DB_CONNECTION_LIMIT ? parseInt(process.env.DB_CONNECTION_LIMIT, 10) : 25,
  queueLimit: 0,
  dateStrings: true,
  charset: 'UTF8MB4_UNICODE_CI',
});

async function testConnection() {
  try {
    const connection = await pool.getConnection();
    connection.release();
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error.message };
  }
}

module.exports = {
  pool,
  testConnection,
};
