// init twilio client - used for authenticating requests
const twilioClient = require("twilio")(
	process.env.TWILIO_ACCOUNT_SID,
	process.env.TWILIO_AUTH_TOKEN
);

module.exports = (req, res, next) => {
	console.debug("skipping authentication check");
	next();
}