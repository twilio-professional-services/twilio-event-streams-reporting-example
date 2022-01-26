var uuidv4 = require('uuid').v4;
var express = require("express");
var debug = require("debug")("event-streams-backend:event");


var authenticate = require("../middleware/authenticate-twilio-signature");
var router = express.Router();

const TASKROUTER = 'com.twilio.taskrouter';
const VOICE_INSIGHTS = 'com.twilio.voice.insights';


const GUIDE = "https://www.twilio.com/docs/events/webhook-quickstart#read-and-parse-the-data";
const INVALID_REQUEST_ERROR = `Invalid request: Expexted JSON array of CloudEvents. See ${GUIDE} for more information`;
const PARSE_EVENT_ERROR = `Error processing array item %d, with error: %s`
const UNHANDLED_EVENT = "Unhandled event: %s";
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
const CONVO_REVOKED = "REVOKED CONVERSATION"; // TBD if this segment actually exists
const AGENT_STATE = "AGENT STATE";
const AGENT_STATE_IN_PROGRESS = "AGENT STATE IN PROGRESS";


// EVENT TYPES
const ET_TASK_QUEUE_ENTERED = "task-queue.entered";
const ET_TASK_TRANSFER_INITIATED = "task.transfer-initiated";
const ET_RESERVATION_CREATED = "reservation.created";
const ET_RESERVATION_ACCEPTED = "reservation.accepted";
const ET_RESERVATION_REJECTED = "reservation.rejected";
const ET_RESERVATION_TIMEOUT = "reservation.timeout";
const ET_RESERVATION_CANCELLED = "reservation.canceled";
const ET_RESERVATION_WRAPUP = "reservation.wrapup"
const ET_RESERVATION_COMPLETED = "reservation.completed";
const ET_TASK_CANCELLED = "task.canceled";
const ET_TASK_TRANSFER_FAILED = "task.transfer-failed";




const logCloudEvent = (cloudEvent, index) => {
  //console.debug("id: ", cloudEvent.id);
  //console.debug("type: ", cloudEvent.type);
}

const getLastQueueEntryEventForTask = (trEvents, task_sid) => {
  try {
    return trEvents.chain()
      .find({ "payload.task_sid": task_sid })
      .where(function (obj) {
        var { eventtype } = obj.payload;
        return (eventtype === ET_TASK_QUEUE_ENTERED || eventtype == ET_TASK_TRANSFER_INITIATED)
      })
      .simplesort("payload.timestamp", true)
      .data()[0]
  } catch (err) {
    console.error(ERROR_FETCHING_DATA, task_sid, err);
  }
}

const getCreatedEventForReservation = (trEvents, reservation_sid) => {
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

const getWrapupEventForReservation = (trEvents, reservation_sid) => {
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

const getAcceptedEventForReservation = (trEvents, reservation_sid) => {
  try {
    return trEvents.chain()
      .find({ "payload.reservation_sid": reservation_sid, "payload.eventtype": ET_RESERVATION_ACCEPTED })
      .data()[0]
  } catch (err) {
    console.error(ERROR_FETCHING_DATA, reservation_sid, err);
  }
}

const getConvoInProgress = (conversations, reservation_sid) => {
  try {
    return conversations.chain()
      .find({ reservation_sid, "segment_kind": CONVO_IN_PROG_SEG })
      .data()[0]
  } catch (err) {
    console.error(ERROR_FETCHING_DATA, reservation_sid, err);
  }
}

const getTimeInQueueForEvent = (trEvents, currentEvent) => {
  var queueEnteredEvent = getLastQueueEntryEventForTask(trEvents, currentEvent.payload.task_sid);
  // we need to set the milliseconds to 0 before subtracting
  // as flex insights ignores those.
  var startDate = new Date(queueEnteredEvent.payload.timestamp).setMilliseconds(0)
  var endDate = new Date(currentEvent.payload.timestamp).setMilliseconds(0);
  return Math.round((endDate - startDate) / 1000);
}

const getRingTimeForEvent = (trEvents, currentEvent) => {
  var reservationCreatedEvent = getCreatedEventForReservation(trEvents, currentEvent.payload.reservation_sid);
  // we need to set the milliseconds to 0 before subtracting
  // as flex insights ignores those.
  var startDate = new Date(reservationCreatedEvent.payload.timestamp).setMilliseconds(0)
  var endDate = new Date(currentEvent.payload.timestamp).setMilliseconds(0)
  return Math.round((endDate - startDate) / 1000);
}

const getTalkTimeForEvent = (trEvents, currentEvent) => {
  var wrapupEvent = getWrapupEventForReservation(trEvents, currentEvent.payload.reservation_sid);
  var acceptedEvent = getAcceptedEventForReservation(trEvents, currentEvent.payload.reservation_sid);

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

const getWrapupTimeForEvent = (trEvents, currentEvent) => {
  var wrapupEvent = getWrapupEventForReservation(trEvents, currentEvent.payload.reservation_sid);

  // if there was a wrap time calculate it
  if (wrapupEvent) {
    var completedTime = new Date(currentEvent.payload.timestamp).setMilliseconds(0);
    var wrapTime = new Date(wrapupEvent.payload.timestamp).setMilliseconds(0);
    return Math.round((completedTime - wrapTime) / 1000)
  }

  // if there was no wrap event always return 0
  return 0
}

const insertConversationSegment = (conversations, segment) => {
  try {
    if (!segment.conversation_id || !segment.segment_kind || !segment.segment_external_id) throw new Exception("Missing key data");
    conversations.insert({
      uuid: uuidv4(),
      // required elements  
      conversation_id: segment.conversation_id,
      segment_kind: segment.segment_kind,
      segment_external_id: segment.segment_external_id,

      // this doesnt actually exist on the flex insights data model
      // but is required to match the conversation in progress to the
      // correct reservation completed event.
      reservation_sid: segment.reservation_sid || '',

      // ** facts AKA measures ******
      //TR Facts
      activity_time: segment.activity_time,
      abandon_time: segment.abandon_time,
      queue_time: segment.queue_time,
      ring_time: segment.ring_time,
      talk_time: segment.talk_time,
      wrapup_time: segment.wrapup_time,
      time_in_seconds: segment.time_in_seconds,

      // Voice Facts (requires dual channel recording setup)
      agent_talk_time: segment.agent_talk_time,
      cross_talk_time: segment.cross_talk_time,
      customer_talk_time: segment.customer_talk_time,
      longest_silence_before_agent: segment.longest_silence_before_agent,
      longest_silence_before_customer: segment.longest_silence_before_customer,
      longest_talk_by_agent: segment.longest_talk_by_agent,
      longest_talk_by_customer: segment.longest_talk_by_customer,
      silence_time: segment.silence_time,

      // Voice facts from conference events
      hold_time: segment.hold_time,

      // Chat facts not populated in flex insights
      average_response_time: segment.average_response_time,
      first_response_time: segment.first_response_time,
      focus_time: segment.focus_time,
      ivr_time: segment.ivr_time,
      priority: segment.priority,

      // attributes
      date: segment.date || new Date(), // to be converted to date of flex insights instance
      time: segment.time || new Date(), // to be converted to seconds from midnight in insight instance timezone
      abandoned: segment.abandoned || 'N',
      abandoned_phase: segment.abandoned_phase

    })
  } catch (err) {
    console.error(ERROR_LOGGING_CONVERSATION, err);
  }
}

const updateConversationSegment = (conversations, segment) => {
  try {

    const convo_in_prog = getConvoInProgress(conversations, segment.reservation_sid);
    const updated_conversation = {
      ...convo_in_prog,
      ...segment
    }
    conversations.update(updated_conversation);
  } catch (err) {
    console.error(ERROR_LOGGING_CONVERSATION, err);
  }
}

const cacheTaskRouterEvent = (trEvents, event) => {
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
      var trEvents = req.app.get("trEvents");
      var currentEvent = cacheTaskRouterEvent(trEvents, event);

      var { eventtype } = currentEvent.payload;
      switch (eventtype) {
        case ET_RESERVATION_ACCEPTED:
          // calculate the stats
          var queue_time = getTimeInQueueForEvent(trEvents, currentEvent);
          var ring_time = getRingTimeForEvent(trEvents, currentEvent);

          // prepare the queue segment
          var queue_segment = {
            conversation_id: currentEvent.payload.task_attributes.conversations?.conversation_id || currentEvent.payload.task_sid,
            segment_kind: QUEUE_SEGMENT,
            segment_external_id: `${currentEvent.payload.task_sid}`,
            queue_time: queue_time,
          }

          // prepare the conversation segment
          var convo_in_progress_segment = {
            conversation_id: currentEvent.payload.task_attributes.conversations?.conversation_id || currentEvent.payload.task_sid,
            segment_kind: CONVO_IN_PROG_SEG,
            segment_external_id: `${currentEvent.payload.task_sid}`,
            reservation_sid: currentEvent.payload.reservation_sid,
            queue_time: queue_time,
            ring_time: ring_time,
          }

          // fetch conversations table
          var conversations = req.app.get("conversations");
          // write segments to conversation table
          insertConversationSegment(conversations, queue_segment);
          insertConversationSegment(conversations, convo_in_progress_segment);

          break;
        case ET_RESERVATION_REJECTED:
          // calculate the stats
          var ring_time = getRingTimeForEvent(trEvents, currentEvent);

          // prepare the conversation REJECTED segment
          var convo_rejected_segment = {
            conversation_id: currentEvent.payload.task_attributes.conversations?.conversation_id || currentEvent.payload.task_sid,
            segment_kind: CONVO_REJECTED,
            segment_external_id: `${currentEvent.payload.task_sid}`,
            reservation_sid: currentEvent.payload.reservation_sid,
            ring_time: ring_time,
          }

          // fetch conversations table
          var conversations = req.app.get("conversations");
          // write rejected segment
          insertConversationSegment(conversations, convo_rejected_segment);
          break;
        // ET_RESERVATION_TIMEOUT TIMEOUT Falls through to ET_RESERVATION_CANCELLED
        // as it has the same behavior
        case ET_RESERVATION_TIMEOUT:
        case ET_RESERVATION_CANCELLED:
          // calculate the stats
          var ring_time = getRingTimeForEvent(trEvents, currentEvent);

          // prepare the conversation REJECTED segment
          var convo_timeout_segment = {
            conversation_id: currentEvent.payload.task_attributes.conversations?.conversation_id || currentEvent.payload.task_sid,
            segment_kind: CONVO_MISSED,
            segment_external_id: `${currentEvent.payload.task_sid}`,
            reservation_sid: currentEvent.payload.reservation_sid,
            ring_time: ring_time,
          }

          // fetch conversations table
          var conversations = req.app.get("conversations");
          // write rejected segment
          insertConversationSegment(conversations, convo_timeout_segment);
          break;
        case ET_RESERVATION_COMPLETED:
          // calculate the talk time
          var talk_time = getTalkTimeForEvent(trEvents, currentEvent);
          var wrapup_time = getWrapupTimeForEvent(trEvents, currentEvent);

          var convo_update = {
            conversation_id: currentEvent.payload.task_attributes.conversation_id || currentEvent.payload.task_sid,
            segment_kind: CONVO_SEG,
            segment_external_id: `${currentEvent.payload.task_sid}`,
            reservation_sid: currentEvent.payload.reservation_sid,
            talk_time: talk_time,
            wrapup_time: wrapup_time
          }

          // update conversation in progress
          var conversations = req.app.get("conversations");
          updateConversationSegment(conversations, convo_update);
          break;
        // ET_TASK_CANCELLED TIMEOUT Falls through to ET_TASK_TRANSFER_FAILED
        // as it has the same behavior
        case ET_TASK_CANCELLED:
        case ET_TASK_TRANSFER_FAILED:
          // calculate the stats
          var queue_time = getTimeInQueueForEvent(trEvents, currentEvent);

          // prepare the queue segment
          var queue_segment = {
            conversation_id: currentEvent.payload.task_attributes.conversations?.conversation_id || currentEvent.payload.task_sid,
            segment_kind: QUEUE_SEGMENT,
            segment_external_id: `${currentEvent.payload.task_sid}`,
            queue_time: queue_time,
            abandon_time: queue_time,
            abandoned_phase: "Queue",
            abandoned: "Yes"
          }

          // prepare the conversation segment that is written by flex insights
          // when a call is abandoned in queue
          var conversation = {
            conversation_id: currentEvent.payload.task_attributes.conversations?.conversation_id || currentEvent.payload.task_sid,
            segment_kind: CONVO_SEG,
            segment_external_id: `${currentEvent.payload.task_sid}`,
            queue_time: queue_time,
            abandon_time: queue_time,
            abandoned_phase: "Queue",
            abandoned: "Yes"
          }

          // fetch conversations table
          var conversations = req.app.get("conversations");
          // write segments to conversation table
          insertConversationSegment(conversations, queue_segment);
          insertConversationSegment(conversations, conversation)
          break;
        default:
          debug(UNHANDLED_EVENT, eventtype);
      }

    } else if (event.type.startsWith(VOICE_INSIGHTS)) {
      var viEvents = req.app.get("viEvents");
      viEvents.insert({ "data": event.data.payload });
    } else {
      console.error(UNEXPECTED_EVENT_TYPE, event.type);
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
