const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { getRedisClient } = require('../config/redis');

router.get('/', async (req, res) => {
  try {
    // Check database
    await pool.query('SELECT 1');
    const dbStatus = 'healthy';

    // Check Redis
    let redisStatus = 'healthy';
    try {
      await getRedisClient().ping();
    } catch (error) {
      redisStatus = 'unhealthy';
    }

    const health = {
      status: dbStatus === 'healthy' && redisStatus === 'healthy' ? 'healthy' : 'degraded',
      service: 'matching-service',
      timestamp: new Date().toISOString(),
      checks: {
        database: dbStatus,
        redis: redisStatus,
      },
    };

    const statusCode = health.status === 'healthy' ? 200 : 503;
    res.status(statusCode).json(health);
  } catch (error) {
    res.status(503).json({
      status: 'unhealthy',
      service: 'matching-service',
      error: error.message,
    });
  }
});

module.exports = router;
