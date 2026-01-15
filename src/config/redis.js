const redis = require('redis');
const logger = require('../utils/logger');

let client = null;

async function initializeRedis() {
  try {
    client = redis.createClient({
      socket: {
        host: process.env.REDIS_HOST || 'localhost',
        port: process.env.REDIS_PORT || 6379,
      },
    });

    client.on('error', (err) => logger.error('Redis Client Error', err));
    client.on('connect', () => logger.info('Redis connecting...'));
    client.on('ready', () => logger.info('Redis ready'));

    await client.connect();
    return client;
  } catch (error) {
    logger.error('Redis initialization error', error);
    throw error;
  }
}

function getRedisClient() {
  if (!client) {
    throw new Error('Redis client not initialized');
  }
  return client;
}

module.exports = {
  initializeRedis,
  getRedisClient,
};
