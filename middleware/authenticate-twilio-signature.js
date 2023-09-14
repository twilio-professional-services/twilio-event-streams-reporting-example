const client = require("twilio");
var debug = require("debug")("event-streams-backend:authentication");

module.exports = (req, res, next) => {
  const result = client.validateRequest(process.env.TWILIO_AUTH_TOKEN, req.get("X-Twilio-Signature"), `https://${req.get('host')}${req.originalUrl}`, {});
  
  if (result) {
    debug("Request validation successful");
    return next();
  }
  
  debug("Request validation failed");
  return next("Error");
}