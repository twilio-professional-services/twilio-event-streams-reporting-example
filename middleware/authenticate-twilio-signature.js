const twilio = require("twilio");
var debug = require("debug")("event-streams-backend:authentication");

module.exports = (req, res, next) => {
	debug("passed");
	next();
}