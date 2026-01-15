const express = require('express');
const router = express.Router();
const { pool } = require('../config/database');
const { publishToQueue } = require('../config/messageQueue');
const matchingService = require('../services/matchingService');
const { validateMatchRequest } = require('../middleware/validation');
const logger = require('../utils/logger');

// Manual match endpoint
router.post('/match', validateMatchRequest, async (req, res, next) => {
  try {
    const matches = await matchingService.matchRequest(req.body);

    res.status(200).json({
      requestId: req.body.requestId,
      matches: matches.filter((m) => m.skillType),
      resourceMatches: matches.filter((m) => m.resourceType),
      matchedAt: new Date().toISOString(),
    });
  } catch (error) {
    next(error);
  }
});

// Accept match
router.post('/matches/:matchId/accept', async (req, res, next) => {
  try {
    const { matchId } = req.params;
    const { volunteerId } = req.body;

    const result = await pool.query(
      'UPDATE matches SET status = $1, accepted_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP WHERE match_id = $2 AND volunteer_id = $3 RETURNING *',
      ['accepted', matchId, volunteerId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Match not found or unauthorized' },
      });
    }

    const match = result.rows[0];

    // Notify SOS service
    publishToQueue(process.env.RABBITMQ_QUEUE_SOS || 'sos.requests', {
      event: 'match.accepted',
      data: {
        matchId,
        requestId: match.request_id,
        volunteerId,
      },
    });

    res.json({
      matchId,
      status: match.status,
      acceptedAt: match.accepted_at,
      updatedAt: match.updated_at,
    });
  } catch (error) {
    next(error);
  }
});

// Reject match
router.post('/matches/:matchId/reject', async (req, res, next) => {
  try {
    const { matchId } = req.params;
    const { volunteerId, reason } = req.body;

    const result = await pool.query(
      'UPDATE matches SET status = $1, rejected_at = CURRENT_TIMESTAMP, rejection_reason = $2, updated_at = CURRENT_TIMESTAMP WHERE match_id = $3 AND volunteer_id = $4 RETURNING *',
      ['rejected', reason, matchId, volunteerId]
    );

    if (result.rows.length === 0) {
      return res.status(404).json({
        error: { code: 'NOT_FOUND', message: 'Match not found or unauthorized' },
      });
    }

    res.json({
      matchId,
      status: result.rows[0].status,
      rejectedAt: result.rows[0].rejected_at,
    });
  } catch (error) {
    next(error);
  }
});

// Get matches for a request
router.get('/matches', async (req, res, next) => {
  try {
    const { requestId } = req.query;

    if (!requestId) {
      return res.status(400).json({
        error: { code: 'MISSING_PARAMETER', message: 'requestId is required' },
      });
    }

    const result = await pool.query(
      'SELECT * FROM matches WHERE request_id = $1 ORDER BY match_score DESC',
      [requestId]
    );

    const matches = result.rows.map((row) => ({
      matchId: row.match_id,
      requestId: row.request_id,
      volunteerId: row.volunteer_id,
      skillId: row.skill_id,
      resourceId: row.resource_id,
      skillType: row.skill_type,
      resourceType: row.resource_type,
      matchScore: parseFloat(row.match_score),
      distance: parseFloat(row.distance),
      trustScore: row.trust_score ? parseFloat(row.trust_score) : null,
      status: row.status,
      createdAt: row.created_at,
      acceptedAt: row.accepted_at,
      rejectedAt: row.rejected_at,
    }));

    res.json({ matches });
  } catch (error) {
    next(error);
  }
});

// Get matching statistics
router.get('/stats', async (req, res, next) => {
  try {
    const totalResult = await pool.query('SELECT COUNT(*) as total FROM matches');
    const acceptedResult = await pool.query(
      "SELECT COUNT(*) as total FROM matches WHERE status = 'accepted'"
    );
    const rejectedResult = await pool.query(
      "SELECT COUNT(*) as total FROM matches WHERE status = 'rejected'"
    );
    const pendingResult = await pool.query(
      "SELECT COUNT(*) as total FROM matches WHERE status = 'pending'"
    );

    const avgTimeResult = await pool.query(`
      SELECT AVG(EXTRACT(EPOCH FROM (accepted_at - created_at))) as avg_seconds
      FROM matches
      WHERE accepted_at IS NOT NULL
    `);

    const stats = {
      totalMatches: parseInt(totalResult.rows[0].total),
      acceptedMatches: parseInt(acceptedResult.rows[0].total),
      rejectedMatches: parseInt(rejectedResult.rows[0].total),
      pendingMatches: parseInt(pendingResult.rows[0].total),
      averageMatchTime: avgTimeResult.rows[0].avg_seconds
        ? formatDuration(avgTimeResult.rows[0].avg_seconds)
        : '00:00:00',
    };

    res.json(stats);
  } catch (error) {
    next(error);
  }
});

function formatDuration(seconds) {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const secs = Math.floor(seconds % 60);
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

module.exports = router;
