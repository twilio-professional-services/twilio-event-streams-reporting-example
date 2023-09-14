// app is global variable initialized in app.js
var trEvents = app.get("trEvents");
var conversations = app.get("conversations");
var agents = app.get("agents");
var uuid = require('uuid').v4;
var express = require("express");
var logTaskRouter = require("debug")("event-streams-backend:tr-event");
var logConversation = require("debug")("event-streams-backend:conversations");
var logAgents = require("debug")("event-streams-backend:agents");
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
const ERROR_LOGGING_AGENT = "Unexpected error logging agent: %s";

// Segment types
const QUEUE_SEGMENT = "QUEUE";
const CONVO_SEG = "CONVERSATION";
const CONVO_IN_PROG_SEG = "CONVERSATION IN PROGRESS";
const CONVO_CORRUPTED = "CORRUPTED CONVERSATION"; //TO-DO
const CONVO_REJECTED = "REJECTED CONVERSATION";
const CONVO_MISSED = "MISSED CONVERSATION";
const CONVO_REVOKED = "REVOKED CONVERSATION";
const AGENT_STATUS = "AGENT STATUS"; 
const AGENT_STATUS_IN_PROGRESS = "AGENT STATUS IN PROGRESS";

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
const ET_WORKER_CREATED = "worker.created";
const ET_WORKER_DELETED = "worker.deleted";
const ET_WORKER_ACTIVITY_UPDATED = "worker.activity.update";
const ET_WORKER_ATTRIBUTES_UPDATED = "worker.attributes.update";

// AGENT DEFINITION STATUS
const AGENT_ACTIVE = "Active";
const AGENT_DELETED = "Deleted";


const logCloudEvent = (cloudEvent, index) => {
  logeventStream("id: ", cloudEvent.id);
  logeventStream("type: ", cloudEvent.type);
  logeventStream("index: ", index);
  if(cloudEvent.data?.test_id){
    logeventStream("test-id", cloudEvent.data.test_id);
  }
}

// identify the last entry event preceeding the current exit event by timestamp
// as only one reservation can be in queue at a time
const getQueueEntryEventByTaskExitTime = (task_sid, exitTimestamp) => {
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

const getConvoInProgressSegment = (reservation_sid) => {
  try {
    return conversations.chain()
      .find({ reservation_sid, "segment_kind": CONVO_IN_PROG_SEG })
      .data()[0]
  } catch (err) {
    console.error(ERROR_FETCHING_DATA, reservation_sid, err);
  }
}

const getAgentStatusInProgressSegment = (agent_uuid) => {
  try {
    return conversations.chain()
      .find({ agent_uuid, "segment_kind": AGENT_STATUS_IN_PROGRESS })
      .data()[0]
  } catch (err) {
    console.error(ERROR_FETCHING_DATA, agent_uuid, err);
  }
}

const getAgentEntry = (agent_uuid) => {
  try {
    return agents.chain()
      .find({ agent_uuid })
      .data()[0]
  } catch (err) {
    console.error(ERROR_FETCHING_DATA, agent_uuid, err);
  }
}

const getQueueDataForExitEvent = (currentEvent) => {
  var { task_sid, timestamp: exitTimestamp } = currentEvent.payload;
  var { timestamp: startTimeStamp } = getQueueEntryEventByTaskExitTime(task_sid, exitTimestamp)?.payload
  // we need to set the milliseconds to 0 before subtracting
  // as flex insights ignores those.
  var startDate = new Date(startTimeStamp).setMilliseconds(0)
  var endDate = new Date(exitTimestamp).setMilliseconds(0);
  return { timeInQueue: Math.round((endDate - startDate) / 1000), startDate }
}

const getRingTimeForEvent = (currentEvent) => {
  var { reservation_sid, timestamp: endtimeStamp } = currentEvent.payload
  var { timestamp: startTimeStamp } = getCreatedEventForReservation(reservation_sid)?.payload
  // we need to set the milliseconds to 0 before subtracting
  // as flex insights ignores those.
  var startDate = new Date(startTimeStamp).setMilliseconds(0)
  var endDate = new Date(endtimeStamp).setMilliseconds(0)
  return Math.round((endDate - startDate) / 1000);
}

const getTalkTimeForCompletedEvent = (currentEvent) => {
  var { reservation_sid, timestamp: completedTimestamp } = currentEvent.payload;
  var { timestamp: wrapupTimestamp } = getWrapupEventForReservation(reservation_sid)?.payload || {};
  var { timestamp: acceptedTimestamp } = getAcceptedEventForReservation(reservation_sid)?.payload

  var acceptedTime = new Date(acceptedTimestamp).setMilliseconds(0);

  // if there was a wrapup event, we calc talk time from that
  if (wrapupTimestamp) {
    var wrapTime = new Date(wrapupTimestamp).setMilliseconds(0);
    return Math.round((wrapTime - acceptedTime) / 1000)
  }

  // otherwise we calc talktime from this event, AKA reservation completed event
  var completedTime = new Date(completedTimestamp).setMilliseconds(0);
  return Math.round((completedTime - acceptedTime) / 1000)
}

const getWrapupTimeForCompletedEvent = (currentEvent) => {
  var { reservation_sid, timestamp: completedTimeStamp } = currentEvent.payload;
  var { timestamp: wrapupEventTimeStamp } = getWrapupEventForReservation(reservation_sid)?.payload || {};

  // if there was no wrapup time return 0
  // otherwise calculate it 
  if (!wrapupEventTimeStamp) return 0

  var completedTime = new Date(completedTimeStamp).setMilliseconds(0);
  var wrapTime = new Date(wrapupEventTimeStamp).setMilliseconds(0);
  return Math.round((completedTime - wrapTime) / 1000);
}

const insertConversationSegment = (segmentDetails, currentEvent) => {
  try {
    var defaultSegment = generateDefaultSegmentWithCustomData(currentEvent);

    if (!segmentDetails.segment_kind) throw new Exception("Missing key data");
    logConversation(conversations.insert({
      ...defaultSegment,
      uuid: uuid(),
      ...segmentDetails
    }));
  } catch (err) {
    console.error(ERROR_LOGGING_CONVERSATION, err);
  }
}

const insertOrUpdateAgent = (currentEvent, insert, status) => {
  try {
    var agentUpdateEntry = generateAgentEntry(currentEvent);
    var { timestamp } = currentEvent.payload;
    if (!agentUpdateEntry.agent_uuid) throw new Exception("Missing key data");
    date_left = status === AGENT_DELETED? new Date(timestamp).setMilliseconds(0) : undefined;

    if(insert){
      logAgents(agents.insert({
        ...agentUpdateEntry,
        date_joined: new Date(timestamp).setMilliseconds(0),
        state: status,
        date_left
      }));
    } else {
      agentsEntry = getAgentEntry(agentUpdateEntry.agent_uuid);
      logAgents(agents.update({
        ...agentsEntry,
        ...agentUpdateEntry,
        state: status,
        date_left
      }));
    }
  } catch (err) {
    if(err.message?.includes("Please save the document first by using insert()") && !insert){
      insertOrUpdateAgent(currentEvent, true, status);
    }
    else{
      console.error(ERROR_LOGGING_AGENT, err);
    }
  }
}

const generateAgentEntry = (currentEvent) => {
  const {
    worker_attributes,
    worker_sid,
  } = currentEvent.payload
  return {
    agent_uuid: worker_sid,
    attribute_1: worker_attributes.agent_attribute_1,
    attribute_2: worker_attributes.agent_attribute_2,
    attribute_3: worker_attributes.agent_attribute_3,
    email: worker_attributes.email,
    // id that comes off the agent attributes, representing an external agent id
    agent_id: worker_attributes.agent_id,
    location: worker_attributes.location,
    phone: worker_attributes.phone,
    // comma seperated values of the roles array as a string
    role: Array.isArray(worker_attributes.roles) ? worker_attributes.roles.join(", ") : worker_attributes.role,
    // status is Active, Deleted
    // handled by the insert / update methods
    state: undefined,

    // flex insights actually only stores the department id on the 
    // agent table and links to a department table.
    // agent table updating events that use the same 
    // department id but different name will update the name for that department id
    // in the department table. In doing so this will change the historical record in flex insights
    // of that department name.  Keeping this flat and historically accurate
    // for now for simplicity but users of this solution to note whether they 
    // want to match flex insights exactly or not in this event
    // the same is  true for team id
    team_id: worker_attributes.team_id,
    team_name: worker_attributes.team_name,
    team_name_in_hierarchy: worker_attributes.team_name_in_hierarchy,
    manager: worker_attributes.manager,
    department_id: worker_attributes.department_id,
    department_name: worker_attributes.department_name,
    department_name_in_hierarchy: worker_attributes.department_name_in_hierarchy
  }
}

const updateConversationInProgressSegment = (segment, reservation_sid) => {
  try {

    const convo_in_prog = getConvoInProgressSegment(reservation_sid);
    const updated_conversation = {
      ...convo_in_prog,
      ...segment
    }
    logConversation(conversations.update(updated_conversation));
  } catch (err) {
    if(err.message?.includes("Please save the document first by using insert()")){
      logConversation("Looks like conversation entry does not exist for updating, perhaps session started after original entity was written");
    }
    else{
      console.error(ERROR_LOGGING_CONVERSATION, err);
    }
  }
}

const updateAgentStatusInProgressSegment = (segment, agent_uuid) => {
  try {

    const agent_status_in_progress = getAgentStatusInProgressSegment(agent_uuid);
    const updated_conversation = {
      ...agent_status_in_progress,
      ...segment
    }
    logConversation(conversations.update(updated_conversation));
  } catch (err) {
    if(err.message?.includes("Please save the document first by using insert()")){
      logConversation("Looks like conversation entry does not exist for updating, perhaps session started after original entity was written");
    }
    else{
      console.error(ERROR_LOGGING_CONVERSATION, err);
    }
  }
}

// method for transforming data common to all segment types
const generateDefaultSegmentWithCustomData = (currentEvent) => {
  var {
    task_attributes,
    worker_attributes,
    task_sid,
    reservation_sid,
    worker_sid,
    timestamp,
    task_completed_reason,
    task_canceled_reason,
    task_channel_unique_name,
    workflow_name,
    task_queue_name,
    task_queue_sid,
    worker_activity_name,
    worker_time_in_previous_activity } = currentEvent.payload;
  var custom_data = {
    ...task_attributes?.conversations,
    ...worker_attributes
  }
  return segment_data = {
    // required elements
    conversation_id: custom_data?.conversation_id || task_sid || worker_sid || uuid(),
    segment_external_id: task_sid || worker_sid || uuid(),
    // this doesnt actually exist on the flex insights data model
    // or if it does it is behind the scenes 
    // but is required to match the conversation in progress to the
    // correct reservation completed event.
    reservation_sid: reservation_sid || '',
    // same for this but to link to the agent table.
    agent_uuid: worker_sid || '',

    //#region FACTS
    // FACTS AKA measures *******
    // *************************************
    // *** TR Facts - common to all channels
    activity_time: worker_time_in_previous_activity,
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
    //#endregion

    //#region ATTRIBUTES
    // ** ATTRIBUTES ***
    date: new Date(timestamp).setMilliseconds(0), // this will be formatted later
    time: new Date(timestamp).setMilliseconds(0), // this will be formatted later
    abandoned: custom_data?.abandoned || 'N',
    abandoned_phase: custom_data?.abandoned_phase,
    activity: custom_data?.activity || worker_activity_name,
    campaign: custom_data?.campaign,
    case: custom_data?.case,
    channel: custom_data?.channel || (task_channel_unique_name === "voice" ? "Call" : undefined) || (task_channel_unique_name === "chat" ? "Chat" : task_channel_unique_name),
    content: custom_data?.content,
    conversation_attribute_1: custom_data?.conversation_attribute_1,
    conversation_attribute_2: custom_data?.conversation_attribute_2,
    conversation_attribute_3: custom_data?.conversation_attribute_3,
    conversation_attribute_4: custom_data?.conversation_attribute_4,
    conversation_attribute_5: custom_data?.conversation_attribute_5,
    conversation_attribute_6: custom_data?.conversation_attribute_6,
    conversation_attribute_7: custom_data?.conversation_attribute_7,
    conversation_attribute_8: custom_data?.conversation_attribute_8,
    conversation_attribute_9: custom_data?.conversation_attribute_9,
    conversation_attribute_10: custom_data?.conversation_attribute_10,
    conversation_label_1: custom_data?.conversation_label_1,
    conversation_label_2: custom_data?.conversation_label_2,
    conversation_label_3: custom_data?.conversation_label_3,
    conversation_label_4: custom_data?.conversation_label_4,
    conversation_label_5: custom_data?.conversation_label_5,
    conversation_label_6: custom_data?.conversation_label_6,
    conversation_label_7: custom_data?.conversation_label_7,
    conversation_label_8: custom_data?.conversation_label_8,
    conversation_label_9: custom_data?.conversation_label_9,
    conversation_label_10: custom_data?.conversation_label_10,
    destination: custom_data?.destination,
    direction: custom_data?.direction || (task_attributes.direction === "inbound" ? "Inbound" : undefined) || (task_attributes.direction === "internal" ? "Internal" : undefined) || (task_attributes.direction === "outbound" ? "Outbound" : "Inbound"),
    external_contact: custom_data?.external_contact || (task_attributes.direction === "outbound" ? task_attributes.from : task_attributes.to),
    followed_by: custom_data?.followed_by,

    // flex insights actually only storres the department id on the 
    // conversations table and links to a department table.
    // Conversation generating events that use the same 
    // department id but different name will update the name for that department id
    // in the departmen table. In doing so this will change the historical record in flex insights
    // of that department name.  Keeping this flat and historically accurate
    // for now for simplicity but users of this solution to note whether they 
    // want to match flex insights exactly or not in this event
    handling_department_id: custom_data?.department_id,
    handling_department_name: custom_data?.department_name,
    handling_department_name_in_hierarchy: Array.isArray(custom_data?.handling_department_name_in_hierarchy) ? custom_data?.handling_department_name_in_hierarchy.join(" ▸ ") : custom_data?.handling_department_name_in_hierarchy,
   
    // the above statement for department_id is also true for team_id
    handling_team_id: custom_data?.team_id || custom_data?.team || task_queue_sid,
    handling_team_name: custom_data?.team_name || custom_data?.team || task_queue_name,
    handling_team_name_in_hierarchy: Array.isArray(custom_data?.team_name_in_hierarchy) ? custom_data?.team_name_in_hierarchy.join(" ▸ ") : custom_data?.team_name_in_hierarchy,
    
    // hang_up_by does actually come from voice insights.call summary events on event streams
    // but doesnt get populated by flex insights by default
    hang_up_by: custom_data?.hang_up_by,
    in_business_hours: custom_data?.in_business_hours,
    initiated_by: custom_data?.initiated_by,
    initiative: custom_data?.initiative,
    ivr_path: custom_data?.ivr_path,
    language: custom_data?.language,
    order: custom_data?.order,
    outcome: custom_data?.outcome || task_attributes.reason || task_completed_reason || task_canceled_reason,
    preceded_by: custom_data?.preceded_by,
    productive: custom_data?.productive,
    queue: custom_data?.queue || task_queue_name,
    segment_link: custom_data?.segment_link,
    service_level: custom_data?.service_level,
    source: custom_data?.source,
    virtual: custom_data?.virtual,
    workflow: custom_data?.workflow || workflow_name,
    //#endregion

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
          var queueData = getQueueDataForExitEvent(currentEvent);
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
          var talk_time = getTalkTimeForCompletedEvent(currentEvent);
          var wrapup_time = getWrapupTimeForCompletedEvent(currentEvent);
          var { reservation_sid, task_attributes } = currentEvent.payload;

          var convo_update = {
            segment_kind: CONVO_SEG,
            talk_time: talk_time,
            wrapup_time: wrapup_time,
            segment_link: task_attributes.conversations?.segment_link
          }

          updateConversationInProgressSegment(convo_update, reservation_sid);
          break;
        // ET_TASK_CANCELLED TIMEOUT Falls through to ET_TASK_TRANSFER_FAILED
        // as it has the same behavior
        case ET_TASK_CANCELLED:
        case ET_TASK_TRANSFER_FAILED:
          // calculate the stats
          var queueData = getQueueDataForExitEvent(currentEvent);

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
        case ET_WORKER_CREATED:
          var { worker_activity_name } = currentEvent.payload;
          // prepare the agent_in_progress segment
          var agent_in_progress_segment = {
            segment_kind: AGENT_STATUS_IN_PROGRESS,
            activity: worker_activity_name,
          }
          // insert "current state" of agent to agent table
          insertOrUpdateAgent(currentEvent, true, AGENT_ACTIVE);
          // insert "agent in progress" segment on conversation table
          insertConversationSegment(agent_in_progress_segment, currentEvent);
          break;
        case ET_WORKER_DELETED:
          // update agent state to deleted
          insertOrUpdateAgent(currentEvent, false, AGENT_DELETED);
          break;
        case ET_WORKER_ATTRIBUTES_UPDATED:
          // update agent attributes on "current state" agent table
          insertOrUpdateAgent(currentEvent, false, AGENT_ACTIVE)
          break;
        case ET_WORKER_ACTIVITY_UPDATED:
          var { 
            worker_sid: agent_uuid, 
            worker_time_in_previous_activity,
            worker_activity_name } = currentEvent.payload;
          // prepare the agent_in_progress segment
          var agent_status = {
            segment_kind: AGENT_STATUS,
            activity_time: worker_time_in_previous_activity
          }
          var agent_in_progress_segment = {
            segment_kind: AGENT_STATUS_IN_PROGRESS,
            activity: worker_activity_name,
            activity_time: undefined,
          }

          // we really only need to insert the agent if it doesnt
          // exist already as updating each time is inefficient
          insertOrUpdateAgent(currentEvent, false, AGENT_ACTIVE)

          // move the previous "agent state in progress" to "agent state"
          // insert the new "agent in progress state"
          updateAgentStatusInProgressSegment(agent_status, agent_uuid); 
          insertConversationSegment(agent_in_progress_segment, currentEvent);

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
