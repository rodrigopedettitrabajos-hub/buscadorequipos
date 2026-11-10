const fs = require('fs');
// Optional .env (dev overrides); the exe runs with the defaults below.
const envFile = __dirname + '/.env';
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);
const sql = require('mssql');

// Credentials come from the login form; never stored on disk.
function connect(user, password) {
  return new sql.ConnectionPool({
    server: process.env.DB_SERVER || '192.168.98.103',
    database: process.env.DB_NAME || 'G001',
    user,
    password,
    options: { instanceName: process.env.DB_INSTANCE || undefined, encrypt: false, trustServerCertificate: true },
  }).connect();
}

module.exports = { sql, connect };
