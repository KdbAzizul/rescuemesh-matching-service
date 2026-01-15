const { Pool } = require('pg');
const logger = require('../utils/logger');

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'rescuemesh_matching',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
});

pool.on('error', (err) => {
  logger.error('Unexpected error on idle client', err);
});

// Initialize database schema
async function initializeDatabase() {
  try {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS matches (
        match_id VARCHAR(255) PRIMARY KEY,
        request_id VARCHAR(255) NOT NULL,
        volunteer_id VARCHAR(255) NOT NULL,
        skill_id VARCHAR(255),
        resource_id VARCHAR(255),
        skill_type VARCHAR(100),
        resource_type VARCHAR(100),
        match_score DECIMAL(5,2) NOT NULL,
        distance DECIMAL(10,2),
        trust_score DECIMAL(5,2),
        status VARCHAR(50) DEFAULT 'pending',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        accepted_at TIMESTAMP,
        rejected_at TIMESTAMP,
        rejection_reason TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );

      CREATE INDEX IF NOT EXISTS idx_matches_request_id ON matches(request_id);
      CREATE INDEX IF NOT EXISTS idx_matches_volunteer_id ON matches(volunteer_id);
      CREATE INDEX IF NOT EXISTS idx_matches_status ON matches(status);
      CREATE INDEX IF NOT EXISTS idx_matches_created_at ON matches(created_at);
    `);

    logger.info('Database schema initialized');
  } catch (error) {
    logger.error('Database initialization error', error);
    throw error;
  }
}

module.exports = {
  pool,
  initializeDatabase,
};
