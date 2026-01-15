const logger = require('../utils/logger');

function errorHandler(err, req, res, next) {
  logger.error('Error occurred', {
    error: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
  });

  const statusCode = err.statusCode || 500;
  const message = err.message || 'Internal server error';

  res.status(statusCode).json({
    error: {
      code: err.code || 'INTERNAL_ERROR',
      message,
      ...(process.env.NODE_ENV === 'development' && { stack: err.stack }),
    },
  });
}

module.exports = { errorHandler };
