const sql = require('mssql');

const config = {
  driver: '{ODBC Driver 17 for SQL Server}',
  server: 'glowra.database.windows.net',
  database: 'glowra',
  user: 'glowra',
  password: 'Bbldrizzy98!',
  options: {
    encrypt: true, // For Azure
    trustServerCertificate: false // Change to true for local dev / self-signed certs
  }
};

const poolPromise = new sql.ConnectionPool(config)
  .connect()
  .then(pool => {
    console.log('Connected to MSSQL')
    return pool
  })
  .catch(err => console.log('Database Connection Failed! Bad Config: ', err))

module.exports = {
  sql, poolPromise
}