var express = require("express");
var authenticate = require("../middleware/authenticate-twilio-signature");
var router = express.Router();

parseEventStreamsCloudEvent = (value, index, array) => {
  // https://github.com/cloudevents/spec/blob/v1.0/spec.md
  console.debug("\tevent index", index);
  console.debug("\t\ttype: ", value.type);
  console.debug("\t\tid: ", value.id);
  console.debug("\t\tdataschema: ", value.dataschema);
}

handleEventsBody = (req, res, next) => {
  console.log("New Event");

  if (Array.isArray(req.body)) {
    req.body.forEach(parseEventStreamsCloudEvent);
  } else {
    console.error("\tInvalid request: JSON array of CloudEvents. See https://www.twilio.com/docs/events/webhook-quickstart#read-and-parse-the-data for more details");
    console.error("\tbody: ", req.body);
  }

  res.send();
}

router.options("/", (req, res, next) => {
  res.send();
});

router.post("/", authenticate, handleEventsBody);

module.exports = router;
