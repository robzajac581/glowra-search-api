const sql = require('mssql');
require('dotenv').config();

class DatabaseConnection {
  constructor() {
    this.pool = null;
    this.connected = false;
  }

  async getConnection() {
    if (this.connected && this.pool) {
      return this.pool;
    }

    try {
      const config = {
        driver: process.env.DB_DRIVER || '{ODBC Driver 17 for SQL Server}',
        server: process.env.DB_SERVER,
        database: process.env.DB_NAME,
        user: process.env.DB_USER,
        password: process.env.DB_PASSWORD,
        options: {
          encrypt: true,
          trustServerCertificate: process.env.NODE_ENV === 'development'
        }
      };

      // Validate config
      if (!config.server || !config.database || !config.user || !config.password) {
        throw new Error('Missing database configuration. Check your environment variables.');
      }

      this.pool = await new sql.ConnectionPool(config).connect();
      this.connected = true;
      console.log('Connected to MSSQL');
      return this.pool;
    } catch (err) {
      this.connected = false;
      this.pool = null;
      console.error('Database Connection Failed:', err);
      throw err;
    }
  }

  async close() {
    try {
      if (this.pool) {
        await this.pool.close();
        this.connected = false;
        this.pool = null;
        console.log('Database connection closed');
      }
    } catch (err) {
      console.error('Error closing database connection:', err);
      throw err;
    }
  }
}

const db = new DatabaseConnection();

module.exports = {
  sql,
  db
};