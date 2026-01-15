require('dotenv').config();
const express = require('express');
const cors = require('cors');
const { initializeDatabase } = require('./config/database');
const { initializeRedis } = require('./config/redis');
const { initializeMessageQueue, consumeFromQueue } = require('./config/messageQueue');
const { errorHandler } = require('./middleware/errorHandler');
const logger = require('./utils/logger');
const matchingService = require('./services/matchingService');

const app = express();
const PORT = process.env.PORT || 3005;

// Middleware
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Request logging
app.use((req, res, next) => {
  logger.info(`${req.method} ${req.path}`, { ip: req.ip });
  next();
});

// Routes
app.use('/health', require('./routes/health'));
app.use('/api/matching', require('./routes/matching'));

// Error handling
app.use(errorHandler);

// 404 handler
app.use((req, res) => {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found' } });
});

// Initialize services
async function startServer() {
  try {
    // Initialize database
    await initializeDatabase();
    logger.info('Database connected');

    // Initialize Redis
    await initializeRedis();
    logger.info('Redis connected');

    // Initialize message queue
    await initializeMessageQueue();
    logger.info('Message queue connected');

    // Start consuming SOS requests
    consumeFromQueue(
      process.env.RABBITMQ_QUEUE_SOS || 'sos.requests',
      async (message) => {
        try {
          const data = JSON.parse(message.content.toString());
          if (data.event === 'sos.request.created') {
            logger.info('Processing SOS request for matching', { requestId: data.data.requestId });
            await matchingService.processSOSRequest(data.data);
          }
        } catch (error) {
          logger.error('Error processing message', error);
        }
      }
    );

    // Start server
    app.listen(PORT, () => {
      logger.info(`Matching Service running on port ${PORT}`);
    });
  } catch (error) {
    logger.error('Failed to start server', error);
    process.exit(1);
  }
}

startServer();

module.exports = app;
