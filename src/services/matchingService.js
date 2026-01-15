const axios = require('axios');
const { v4: uuidv4 } = require('uuid');
const { pool } = require('../config/database');
const { publishToQueue } = require('../config/messageQueue');
const { calculateDistance } = require('../utils/distance');
const logger = require('../utils/logger');

// Disaster-specific skill mapping (rule-based intelligence)
const DISASTER_SKILL_MAP = {
  flood: ['boat_operator', 'swimmer', 'medic', 'rescue_diver'],
  earthquake: ['rescuer', 'structural_engineer', 'medic', 'heavy_lifting'],
  cyclone: ['shelter_manager', 'logistics', 'medic', 'evacuation_specialist'],
  fire: ['firefighter', 'electrician', 'medic', 'smoke_diver'],
  tsunami: ['rescue_diver', 'medic', 'boat_operator', 'swimmer'],
  landslide: ['rescuer', 'medic', 'heavy_lifting', 'structural_engineer'],
};

/**
 * Process SOS request and find matches
 */
async function processSOSRequest(sosData) {
  try {
    const { requestId, disasterId, urgency, requiredSkills, requiredResources, location } = sosData;

    logger.info('Processing matching for request', { requestId });

    // Get disaster details
    let disasterType = 'flood'; // default
    try {
      const disasterResponse = await axios.get(
        `${process.env.DISASTER_SERVICE_URL}/api/disasters/${disasterId}`,
        { timeout: 5000 }
      );
      disasterType = disasterResponse.data.disasterType;
    } catch (error) {
      logger.warn('Could not fetch disaster details', { disasterId, error: error.message });
    }

    // Get relevant skills from skill registry
    const skillMatches = await findSkillMatches(
      disasterType,
      requiredSkills || [],
      location,
      urgency
    );

    // Get relevant resources
    const resourceMatches = await findResourceMatches(
      disasterType,
      requiredResources || [],
      location,
      urgency
    );

    // Save matches to database
    const savedMatches = [];
    for (const match of skillMatches) {
      const matchId = `match-${uuidv4()}`;
      await saveMatch(matchId, requestId, match);
      savedMatches.push({ ...match, matchId });
    }

    for (const match of resourceMatches) {
      const matchId = `match-${uuidv4()}`;
      await saveResourceMatch(matchId, requestId, match);
      savedMatches.push({ ...match, matchId });
    }

    // Update SOS request status
    try {
      await axios.put(
        `${process.env.SOS_SERVICE_URL}/api/sos/requests/${requestId}/status`,
        { status: 'matched' },
        { timeout: 5000 }
      );
    } catch (error) {
      logger.warn('Could not update SOS request status', { requestId, error: error.message });
    }

    // Send notifications to matched volunteers
    for (const match of savedMatches) {
      publishToQueue(process.env.RABBITMQ_QUEUE_NOTIFICATION || 'notifications.send', {
        event: 'match.created',
        data: {
          matchId: match.matchId,
          requestId,
          volunteerId: match.volunteerId || match.ownerId,
          skillType: match.skillType,
          resourceType: match.resourceType,
        },
      });
    }

    logger.info('Matching completed', { requestId, matchesFound: savedMatches.length });

    return savedMatches;
  } catch (error) {
    logger.error('Error processing SOS request', error);
    throw error;
  }
}

/**
 * Find matching skills for a request
 */
async function findSkillMatches(disasterType, requiredSkills, location, urgency) {
  try {
    // Get disaster-relevant skills
    const relevantSkills = DISASTER_SKILL_MAP[disasterType] || [];
    const skillsToFind = requiredSkills.length > 0 ? requiredSkills : relevantSkills;

    const matches = [];

    for (const skillType of skillsToFind) {
      try {
        const response = await axios.get(
          `${process.env.SKILL_SERVICE_URL}/api/skills`,
          {
            params: {
              disasterType,
              location: `${location.latitude},${location.longitude}`,
              radius: process.env.MAX_MATCH_RADIUS || 50,
            },
            timeout: 5000,
          }
        );

        const availableSkills = response.data.skills || [];
        const filteredSkills = availableSkills.filter(
          (skill) =>
            skill.skillType === skillType &&
            skill.availability === 'available' &&
            skill.verified === true
        );

        // Score and rank skills
        for (const skill of filteredSkills) {
          const distance = calculateDistance(
            location.latitude,
            location.longitude,
            skill.location.latitude,
            skill.location.longitude
          );

          const matchScore = calculateMatchScore(skill, distance, urgency);

          if (matchScore >= parseFloat(process.env.MATCH_SCORE_THRESHOLD || 5.0)) {
            matches.push({
              volunteerId: skill.userId,
              skillId: skill.skillId,
              skillType: skill.skillType,
              matchScore,
              distance,
              trustScore: skill.trustScore || 5.0,
              availability: skill.availability,
            });
          }
        }
      } catch (error) {
        logger.warn('Error fetching skills', { skillType, error: error.message });
      }
    }

    // Sort by match score and limit
    matches.sort((a, b) => b.matchScore - a.matchScore);
    return matches.slice(0, parseInt(process.env.MAX_MATCHES_PER_REQUEST || 10));
  } catch (error) {
    logger.error('Error finding skill matches', error);
    return [];
  }
}

/**
 * Find matching resources for a request
 */
async function findResourceMatches(disasterType, requiredResources, location, urgency) {
  try {
    const matches = [];

    for (const resourceType of requiredResources) {
      try {
        const response = await axios.get(
          `${process.env.SKILL_SERVICE_URL}/api/resources`,
          {
            params: {
              disasterType,
              location: `${location.latitude},${location.longitude}`,
              radius: process.env.MAX_MATCH_RADIUS || 50,
            },
            timeout: 5000,
          }
        );

        const availableResources = response.data.resources || [];
        const filteredResources = availableResources.filter(
          (resource) =>
            resource.resourceType === resourceType && resource.availability === 'available'
        );

        for (const resource of filteredResources) {
          const distance = calculateDistance(
            location.latitude,
            location.longitude,
            resource.location.latitude,
            resource.location.longitude
          );

          matches.push({
            resourceId: resource.resourceId,
            resourceType: resource.resourceType,
            ownerId: resource.userId,
            distance,
          });
        }
      } catch (error) {
        logger.warn('Error fetching resources', { resourceType, error: error.message });
      }
    }

    // Sort by distance
    matches.sort((a, b) => a.distance - b.distance);
    return matches.slice(0, parseInt(process.env.MAX_MATCHES_PER_REQUEST || 10));
  } catch (error) {
    logger.error('Error finding resource matches', error);
    return [];
  }
}

/**
 * Calculate match score based on multiple factors
 */
function calculateMatchScore(skill, distance, urgency) {
  let score = 0;

  // Trust score (0-10) contributes 40%
  score += (skill.trustScore || 5.0) * 0.4;

  // Distance score (closer is better, 0-10) contributes 30%
  const maxDistance = parseFloat(process.env.MAX_MATCH_RADIUS || 50);
  const distanceScore = Math.max(0, 10 - (distance / maxDistance) * 10);
  score += distanceScore * 0.3;

  // Urgency multiplier (critical requests prioritize higher trust)
  const urgencyMultiplier = urgency === 'critical' ? 1.2 : urgency === 'high' ? 1.1 : 1.0;
  score *= urgencyMultiplier;

  // Certification level bonus
  if (skill.certificationLevel === 'expert') score += 1.0;
  else if (skill.certificationLevel === 'intermediate') score += 0.5;

  return Math.min(10, score);
}

/**
 * Save match to database
 */
async function saveMatch(matchId, requestId, match) {
  try {
    await pool.query(
      `INSERT INTO matches (
        match_id, request_id, volunteer_id, skill_id, skill_type,
        match_score, distance, trust_score, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
      [
        matchId,
        requestId,
        match.volunteerId,
        match.skillId,
        match.skillType,
        match.matchScore,
        match.distance,
        match.trustScore,
        'pending',
      ]
    );
  } catch (error) {
    logger.error('Error saving match', error);
    throw error;
  }
}

/**
 * Save resource match to database
 */
async function saveResourceMatch(matchId, requestId, match) {
  try {
    await pool.query(
      `INSERT INTO matches (
        match_id, request_id, volunteer_id, resource_id, resource_type,
        match_score, distance, status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        matchId,
        requestId,
        match.ownerId,
        match.resourceId,
        match.resourceType,
        8.0, // Default score for resources
        match.distance,
        'pending',
      ]
    );
  } catch (error) {
    logger.error('Error saving resource match', error);
    throw error;
  }
}

/**
 * Manual matching endpoint handler
 */
async function matchRequest(requestData) {
  return await processSOSRequest({
    requestId: requestData.requestId,
    disasterId: requestData.disasterId,
    urgency: requestData.urgency,
    requiredSkills: requestData.requiredSkills,
    requiredResources: requestData.requiredResources,
    location: requestData.location,
  });
}

module.exports = {
  processSOSRequest,
  matchRequest,
  findSkillMatches,
  findResourceMatches,
};
