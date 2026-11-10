process.loadEnvFile?.(__dirname + '/.env');
const sql = require('mssql');

// Credentials come from the login form; never stored on disk.
function connect(user, password) {
  return new sql.ConnectionPool({
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    user,
    password,
    options: { instanceName: process.env.DB_INSTANCE || undefined, encrypt: false, trustServerCertificate: true },
  }).connect();
}

module.exports = { sql, connect };
