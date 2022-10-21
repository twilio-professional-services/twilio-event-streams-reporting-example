var express = require("express");
var router = express.Router();

/* GET home page. */
router.get("/", function (req, res, next) {


  var { filter_conv_id, filter_seg_id } = req.params;
  var conversations = req.app.get("conversations").find();
  var agents = req.app.get("agents").find();
  var dateFormatter = new Intl.DateTimeFormat(process.env.LOCALE, {
    dateStyle: "short",
    timeZone: process.env.TIMEZONE
  });

  var timeFormatter = new Intl.DateTimeFormat(process.env.LOCALE, {
    timeStyle: "short",
    hour12: false,
    timeZone: process.env.TIMEZONE
  });

  res.render("index", {
    title: "Twilio Flex Event Streams - Reporting Example",
    conversations,
    agents,
    dateFormatter,
    timeFormatter,
    filter_conv_id,
    filter_seg_id
  });
});

module.exports = router;
