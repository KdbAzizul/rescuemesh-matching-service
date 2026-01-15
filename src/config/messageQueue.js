const amqp = require('amqplib');
const logger = require('../utils/logger');

let connection = null;
let channel = null;

async function initializeMessageQueue() {
  try {
    const url = process.env.RABBITMQ_URL || 'amqp://localhost:5672';
    connection = await amqp.connect(url);
    channel = await connection.createChannel();

    // Declare queues
    await channel.assertQueue(process.env.RABBITMQ_QUEUE_SOS || 'sos.requests', {
      durable: true,
    });
    await channel.assertQueue(process.env.RABBITMQ_QUEUE_NOTIFICATION || 'notifications.send', {
      durable: true,
    });

    logger.info('Message queue initialized');
    return { connection, channel };
  } catch (error) {
    logger.error('Message queue initialization error', error);
    throw error;
  }
}

function getChannel() {
  if (!channel) {
    throw new Error('Message queue channel not initialized');
  }
  return channel;
}

function publishToQueue(queue, message) {
  try {
    const ch = getChannel();
    ch.sendToQueue(queue, Buffer.from(JSON.stringify(message)), {
      persistent: true,
    });
    logger.info(`Message published to queue: ${queue}`, { message });
  } catch (error) {
    logger.error('Failed to publish message', error);
    throw error;
  }
}

function consumeFromQueue(queue, callback) {
  try {
    const ch = getChannel();
    ch.consume(queue, callback, { noAck: false });
    logger.info(`Started consuming from queue: ${queue}`);
  } catch (error) {
    logger.error('Failed to consume from queue', error);
    throw error;
  }
}

module.exports = {
  initializeMessageQueue,
  getChannel,
  publishToQueue,
  consumeFromQueue,
};
