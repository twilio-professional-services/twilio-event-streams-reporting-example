var createError = require("http-errors");
var express = require("express");
var path = require("path");
var cookieParser = require("cookie-parser");
var logger = require("morgan");

// init app
var app = express();

// log associated twilio account info used for validating requests
console.info(`AccountSid: ${process.env.TWILIO_ACCOUNT_SID}`);
console.info(`Auth Token: ${process.env.TWILIO_AUTH_TOKEN.slice(0, 5)} ...`);

// view engine setup
app.set("views", path.join(__dirname, "views"));
app.set("view engine", "pug");

app.use(logger("dev"));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

// declare handlers
var indexRouter = require("./routes/index");
var eventsRouter = require("./routes/events");

// map routes
app.use("/", indexRouter);
app.use("/events", eventsRouter);


// catch 404 and forward to error handler
app.use(function (req, res, next) {
  next(createError(404));
});

// error handler
app.use(function (err, req, res, next) {
  // set locals, only providing error in development
  res.locals.message = err.message;
  res.locals.error = req.app.get("env") === "development" ? err : {};

  // render the error page
  res.status(err.status || 500);
  res.render("error");
});

module.exports = { app };
