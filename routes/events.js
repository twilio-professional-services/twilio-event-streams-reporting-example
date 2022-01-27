// app is global variable initialized in app.js
var trEvents = app.get("trEvents");
var conversations = app.get("conversations");
var uuidv4 = require('uuid').v4;
var express = require("express");
var logTaskRouter = require("debug")("event-streams-backend:tr-event");
var logConversation = require("debug")("event-streams-backend:conversations");
var logeventStream = require("debug")("event-streams-backend:event-stream-event");
var logUnhandledEvent = require("debug")("event-streams-backend:unhandled-events");
var authenticate = require("../middleware/authenticate-twilio-signature");
var router = express.Router();



const GUIDE = "https://www.twilio.com/docs/events/webhook-quickstart#read-and-parse-the-data";
const INVALID_REQUEST_ERROR = `Invalid request: Expexted JSON array of CloudEvents. See ${GUIDE} for more information`;
const PARSE_EVENT_ERROR = `Error processing array item %d, with error: %s`
const UNHANDLED_EVENT = "Event cached but doesnt generate any segments: %s";
const UNEXPECTED_EVENT_TYPE = "Unexpected event type recieved: %s";
const ERROR_FETCHING_DATA = "Unexpected error fetching data for task sid %s: %s";
const ERROR_LOGGING_CONVERSATION = "Unexpected error logging conversation: %s";

// Segment types
const QUEUE_SEGMENT = "QUEUE";
const CONVO_SEG = "CONVERSATION";
const CONVO_IN_PROG_SEG = "CONVERSATION IN PROGRESS";
const CONVO_CORRUPTED = "CORRUPTED CONVERSATION";
const CONVO_REJECTED = "REJECTED CONVERSATION";
const CONVO_MISSED = "MISSED CONVERSATION";
const CONVO_REVOKED = "REVOKED CONVERSATION";
const AGENT_STATE = "AGENT STATE"; //TO-DO
const AGENT_STATE_IN_PROGRESS = "AGENT STATE IN PROGRESS"; //TO-DO

// EVENT PRODUCT TYPES
const TASKROUTER = 'com.twilio.taskrouter';

// EVENT TYPES
const ET_TASK_QUEUE_ENTERED = "task-queue.entered";
const ET_TASK_TRANSFER_INITIATED = "task.transfer-initiated";
const ET_RESERVATION_CREATED = "reservation.created";
const ET_RESERVATION_ACCEPTED = "reservation.accepted";
const ET_RESERVATION_REJECTED = "reservation.rejected";
const ET_RESERVATION_TIMEOUT = "reservation.timeout";
const ET_RESERVATION_CANCELLED = "reservation.canceled";
const ET_RESERVATION_RESCINDED = "reservation.rescinded";
const ET_RESERVATION_WRAPUP = "reservation.wrapup"
const ET_RESERVATION_COMPLETED = "reservation.completed";
const ET_TASK_CANCELLED = "task.canceled";
const ET_TASK_TRANSFER_FAILED = "task.transfer-failed";


const logCloudEvent = (cloudEvent, index) => {
  logeventStream("id: ", cloudEvent.id);
  logeventStream("type: ", cloudEvent.type);
  logeventStream("index: ", index);
}

// identify the last entry event preceeding the current exit event
const getLastQueueEntryEventForTask = (task_sid, exitTimestamp) => {
  try {
    return trEvents.chain()
      .find({ "payload.task_sid": task_sid })
      .where(function (obj) {
        var { eventtype, timestamp } = obj.payload;
        return ((timestamp < exitTimestamp) && (eventtype === ET_TASK_QUEUE_ENTERED || eventtype == ET_TASK_TRANSFER_INITIATED))
      })
      .simplesort("payload.timestamp", true)
      .data()[0]
  } catch (err) {
    console.error(ERROR_FETCHING_DATA, task_sid, err);
  }
}

const getCreatedEventForReservation = (reservation_sid) => {
  try {
    return trEvents.chain()
      .find({ "payload.reservation_sid": reservation_sid })
      .where(function (obj) {
        var { eventtype } = obj.payload;
        return (eventtype === ET_RESERVATION_CREATED)
      })
      .simplesort("payload.timestamp", true)
      .data()[0]
  } catch (err) {
    console.error(ERROR_FETCHING_DATA, reservation_sid, err);
  }
}

const getWrapupEventForReservation = (reservation_sid) => {
  try {
    return trEvents.chain()
      .find({ "payload.reservation_sid": reservation_sid })
      .where(function (obj) {
        var { eventtype } = obj.payload;
        return (eventtype === ET_RESERVATION_WRAPUP)
      })
      .simplesort("payload.timestamp", true)
      .data()[0]
  } catch (err) {
    console.error(ERROR_FETCHING_DATA, reservation_sid, err);
  }
}

const getAcceptedEventForReservation = (reservation_sid) => {
  try {
    return trEvents.chain()
      .find({ "payload.reservation_sid": reservation_sid, "payload.eventtype": ET_RESERVATION_ACCEPTED })
      .data()[0]
  } catch (err) {
    console.error(ERROR_FETCHING_DATA, reservation_sid, err);
  }
}

const getConvoInProgress = (reservation_sid) => {
  try {
    return conversations.chain()
      .find({ reservation_sid, "segment_kind": CONVO_IN_PROG_SEG })
      .data()[0]
  } catch (err) {
    console.error(ERROR_FETCHING_DATA, reservation_sid, err);
  }
}

const getQueueDataForEvent = (currentEvent) => {
  var queueEnteredEvent = getLastQueueEntryEventForTask(currentEvent.payload.task_sid, currentEvent.payload.timestamp);
  // we need to set the milliseconds to 0 before subtracting
  // as flex insights ignores those.
  var startDate = new Date(queueEnteredEvent.payload.timestamp).setMilliseconds(0)
  var endDate = new Date(currentEvent.payload.timestamp).setMilliseconds(0);
  return { timeInQueue: Math.round((endDate - startDate) / 1000), startDate }
}

const getRingTimeForEvent = (currentEvent) => {
  var reservationCreatedEvent = getCreatedEventForReservation(currentEvent.payload.reservation_sid);
  // we need to set the milliseconds to 0 before subtracting
  // as flex insights ignores those.
  var startDate = new Date(reservationCreatedEvent.payload.timestamp).setMilliseconds(0)
  var endDate = new Date(currentEvent.payload.timestamp).setMilliseconds(0)
  return Math.round((endDate - startDate) / 1000);
}

const getTalkTimeForEvent = (currentEvent) => {
  var wrapupEvent = getWrapupEventForReservation(currentEvent.payload.reservation_sid);
  var acceptedEvent = getAcceptedEventForReservation(currentEvent.payload.reservation_sid);

  var acceptedTime = new Date(acceptedEvent.payload.timestamp).setMilliseconds(0);

  // if there was a wrapup event, we calc talk time from that
  if (wrapupEvent) {
    var wrapTime = new Date(wrapupEvent.payload.timestamp).setMilliseconds(0);
    return Math.round((wrapTime - acceptedTime) / 1000)
  }

  // otherwise we calc talktime from this event, AKA reservation completed event
  var completedTime = new Date(currentEvent.payload.timestamp).setMilliseconds(0);
  return Math.round((completedTime - acceptedTime) / 1000)

}

const getWrapupTimeForEvent = (currentEvent) => {
  var wrapupEvent = getWrapupEventForReservation(currentEvent.payload.reservation_sid);

  // if there was a wrap time calculate it
  if (wrapupEvent) {
    var completedTime = new Date(currentEvent.payload.timestamp).setMilliseconds(0);
    var wrapTime = new Date(wrapupEvent.payload.timestamp).setMilliseconds(0);
    return Math.round((completedTime - wrapTime) / 1000)
  }

  // if there was no wrap event always return 0
  return 0
}

const insertConversationSegment = (segmentDetails, currentEvent) => {
  try {
    var defaultSegment = generateSegmentFromCustomData(currentEvent);

    if (!segmentDetails.segment_kind) throw new Exception("Missing key data");
    logConversation(conversations.insert({
      ...defaultSegment,
      uuid: uuidv4(),
      ...segmentDetails
    }));
  } catch (err) {
    console.error(ERROR_LOGGING_CONVERSATION, err);
  }
}

const updateConversationInProgressSegment = (segment, reservation_sid) => {
  try {

    const convo_in_prog = getConvoInProgress(reservation_sid);
    const updated_conversation = {
      ...convo_in_prog,
      ...segment
    }
    logConversation(conversations.update(updated_conversation));
  } catch (err) {
    console.error(ERROR_LOGGING_CONVERSATION, err);
  }
}

// method for transforming data common to all segment types
const generateSegmentFromCustomData = (currentEvent) => {
  var { task_attributes, task_sid, reservation_sid, worker_sid, timestamp } = currentEvent.payload;
  var custom_data = task_attributes?.conversations;
  return segment_data = {

    // required elements where present
    conversation_id: custom_data?.conversation_id || task_sid || worker_sid || uuidv4(),
    segment_external_id: task_sid || worker_sid || uuidv4(),

    // this doesnt actually exist on the flex insights data model
    // or of it does it is behind the scenes 
    // but is required to match the conversation in progress to the
    // correct reservation completed event.
    reservation_sid: reservation_sid || '',

    // ** facts AKA measures ******
    //TR Facts - common to all channels
    activity_time: custom_data?.activity_time,
    abandon_time: custom_data?.abandon_time,
    queue_time: custom_data?.queue_time,
    ring_time: custom_data?.ring_time,
    talk_time: custom_data?.talk_time,
    wrapup_time: custom_data?.wrapup_time,
    time_in_seconds: custom_data?.time_in_seconds,

    // Voice Facts - single change
    // these are not available through event streams at this time
    agent_talk_time: custom_data?.agent_talk_time,
    longest_silence_before_agent: custom_data?.longest_silence_before_agent,
    longest_talk_by_agent: custom_data?.longest_talk_by_agent,
    silence_time: custom_data?.silence_time,

    // Voice Facts - dual channel
    // these are not available through event streams at this time
    cross_talk_time: custom_data?.cross_talk_time,
    customer_talk_time: custom_data?.customer_talk_time,
    longest_silence_before_customer: custom_data?.longest_silence_before_customer,
    longest_talk_by_customer: custom_data?.longest_talk_by_customer,

    // Voice facts from conference events
    // these are not available through event streams at this time
    hold_time: custom_data?.hold_time,

    // Chat facts not populated in flex insights
    // by default but can be populated from custom attributes
    // with work done via flex plugins.
    average_response_time: custom_data?.average_response_time,
    first_response_time: custom_data?.first_response_time,
    focus_time: custom_data?.focus_time,

    // Other facts nott populated in flxe insights
    // by default but could be populated form custom attributes
    // with work done via flex plugins
    ivr_time: custom_data?.ivr_time,
    priority: custom_data?.priority,

    // ** ATTRIBUTES ***
    date: new Date(timestamp).setMilliseconds(0), // this will be formatted later
    time: new Date(timestamp).setMilliseconds(0), // this will be formatted later
    abandoned: custom_data?.abandoned || 'N',
    abandoned_phase: custom_data?.abandoned_phase
  }
}

const cacheTaskRouterEvent = (event) => {
  return trEvents.insert({
    "event_id": event.id,
    "payload": {
      ...event.data.payload,
      task_attributes: {
        ...JSON.parse(event.data.payload.task_attributes || "{}")
      },
      worker_attributes: {
        ...JSON.parse(event.data.payload.worker_attributes || "{}")
      }
    },
    "publisher_metadata": event.data.publisher_metadata
  });
}

// Parse each individual event in the array
const parseEventStreamsCloudEvent = (req, event, index, array) => {
  try {
    logCloudEvent(event, index);

    if (event.type.startsWith(TASKROUTER)) {
      var currentEvent = cacheTaskRouterEvent(event);
      logTaskRouter(currentEvent);

      var { eventtype } = currentEvent.payload;
      switch (eventtype) {
        case ET_RESERVATION_ACCEPTED:
          // calculate the stats
          var queueData = getQueueDataForEvent(currentEvent);
          var ring_time = getRingTimeForEvent(currentEvent);

          // prepare the queue segment
          var queue_segment = {
            segment_kind: QUEUE_SEGMENT,
            queue_time: queueData.timeInQueue,
            date: queueData.startDate,
            time: queueData.startDate
          }

          // prepare the conversation segment
          var convo_in_progress_segment = {
            segment_kind: CONVO_IN_PROG_SEG,
            queue_time: queueData.timeInQueue,
            ring_time: ring_time,
          }

          // write segments to conversation table
          insertConversationSegment(queue_segment, currentEvent);
          insertConversationSegment(convo_in_progress_segment, currentEvent);

          break;
        // all these exit points behave the same
        // they just record a different segment type
        case ET_RESERVATION_REJECTED:
        case ET_RESERVATION_TIMEOUT:
        case ET_RESERVATION_CANCELLED:
        case ET_RESERVATION_RESCINDED:

          var segment_kind;
          switch (eventtype) {
            case ET_RESERVATION_REJECTED:
              segment_kind = CONVO_REJECTED;
              break
            case ET_RESERVATION_TIMEOUT:
            case ET_RESERVATION_CANCELLED:
              segment_kind = CONVO_MISSED;
              break
            case ET_RESERVATION_RESCINDED:
              segment_kind = CONVO_REVOKED;
              break
          }

          // calculate the stats
          var ring_time = getRingTimeForEvent(currentEvent);

          // prepare the conversation REJECTED segment
          var convo_failed_segment = {
            segment_kind,
            ring_time: ring_time,
          }

          // write failed segment
          insertConversationSegment(convo_failed_segment, currentEvent);
          break;
        case ET_RESERVATION_COMPLETED:
          // calculate the talk time
          var talk_time = getTalkTimeForEvent(currentEvent);
          var wrapup_time = getWrapupTimeForEvent(currentEvent);
          var { reservation_sid } = currentEvent.payload;

          var convo_update = {
            segment_kind: CONVO_SEG,
            talk_time: talk_time,
            wrapup_time: wrapup_time
          }

          updateConversationInProgressSegment(convo_update, reservation_sid);
          break;
        // ET_TASK_CANCELLED TIMEOUT Falls through to ET_TASK_TRANSFER_FAILED
        // as it has the same behavior
        case ET_TASK_CANCELLED:
        case ET_TASK_TRANSFER_FAILED:
          // calculate the stats
          var queueData = getQueueDataForEvent(currentEvent);

          // prepare the queue segment
          var queue_segment = {
            segment_kind: QUEUE_SEGMENT,
            queue_time: queueData.timeInQueue,
            abandon_time: queueData.timeInQueue,
            abandoned_phase: "Queue",
            abandoned: "Yes",
            date: queueData.startDate,
            time: queueData.startDate
          }

          // prepare the conversation segment that is written by flex insights
          // when a call is abandoned in queue
          var conversation = {
            segment_kind: CONVO_SEG,
            queue_time: queueData.timeInQueue,
            abandon_time: queueData.timeInQueue,
            abandoned_phase: "Queue",
            abandoned: "Yes",
          }

          // write segments to conversation table
          insertConversationSegment(queue_segment, currentEvent);
          insertConversationSegment(conversation, currentEvent)
          break;
        default:
          logUnhandledEvent(UNHANDLED_EVENT, eventtype);
      }

    } else {
      logUnhandledEvent(UNEXPECTED_EVENT_TYPE, event.type);
    }
  } catch (error) {
    console.error(PARSE_EVENT_ERROR, index, error);
  }
}

// Process the full body of an event sent to the events endpoint
const processRequest = (req, res, next) => {
  if (Array.isArray(req.body)) {
    req.body.forEach((event, index, array) => {
      parseEventStreamsCloudEvent(req, event, index, array);
    });
  } else {
    console.error(INVALID_REQUEST_ERROR);
  }
  res.send();
}

router.post("/", authenticate, processRequest);

module.exports = router;
