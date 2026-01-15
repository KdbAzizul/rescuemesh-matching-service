const Joi = require('joi');

const matchRequestSchema = Joi.object({
  requestId: Joi.string().required(),
  disasterId: Joi.string().required(),
  disasterType: Joi.string().valid('flood', 'earthquake', 'cyclone', 'fire', 'tsunami', 'landslide').optional(),
  requiredSkills: Joi.array().items(Joi.string()).optional(),
  requiredResources: Joi.array().items(Joi.string()).optional(),
  location: Joi.object({
    latitude: Joi.number().required(),
    longitude: Joi.number().required(),
  }).required(),
  urgency: Joi.string().valid('critical', 'high', 'medium', 'low').required(),
  radius: Joi.number().positive().optional(),
});

function validateMatchRequest(req, res, next) {
  const { error, value } = matchRequestSchema.validate(req.body, { abortEarly: false });

  if (error) {
    return res.status(400).json({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid request data',
        details: error.details.map((d) => d.message),
      },
    });
  }

  req.body = value;
  next();
}

module.exports = { validateMatchRequest };
