# twilio-flex-event-streams-reporting-example

This project is a node express app that demonstrates processing of event streams data that is then used to model data as it appears in flex insights reporting

# screenshots
![alt text](screenshots/sample.gif)

# Disclaimer
As Open Source Software from Twilio Professional Services, this project is not supported by Twilio Support. This software is to be considered "sample code", a Type B Deliverable, and is delivered "as-is" to the user. Twilio bears no responsibility to support the use or implementation of this software. In using this project, you are assuming ownership over the code and its implementation.

For bug reports and feature requests, please submit a Github Issue.

This solution is provided to demonstrate how to translate the events from task router into the conversations model for flex insights and is not designed for scale. Anyone using this project should consider challenges with consuming events out of order and at large volumes.

# Deploying to heroku

1. Use this link to begin [![Deploy](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy?template=https://github.com/jhunter-twilio/twilio-event-streams-reporting-example/tree/main)

2. Populate the given variables when prompted


   - `TWILIO_ACCOUNT_SID` - the account sid of your twilio account - used for calling Twilio APIs //TODO
   - `TWILIO_AUTH_TOKEN` - the auth token for your twilio account - used for the authentication of requests //TODO
   - `LOCALE` - Locale as setup in flex insights eg en-US
   - `TIMEZONE` - Timezone of flex insights eg "UTC" or "America/New_York"

3. You're all set, the backend is ready. You can access it on https://<HEROKU_APP_NAME>.herokuapp.com

# Deploying locally

1. Clone repository using `git clone https://github.com/twilio-professional-services/twilio-event-streams-reporting-example.git`
2. run `npm install`
3. clone the .env.sample to .env
4. update .env as appropriate, descriptions above
5. run `ngrok http --domain=<preferred domain> 3000`
6. start server using `npm start`

# dependencies

1. Create event streams sink to point to either your heroku `https://<HEROKU_APP_NAME>.herokuapp.com/events` or ngrok domain `https://<ngrok domain>/events`
   - Method: POST
2. Create event streams subscription for taskrouter (v2) events


   *Reservation*
   - reservation.accepted
   - reservation.canceled
   - reservation.completed
   - reservation.created
   - reservation.rejected
   - reservation.rescinded
   - reservation.timeout
   - reservation.wrapup

   *Task*
   - task.canceled
   - task.transfer-failed
   - task.transfer-initiated

   *Task Queue*
   - task-queue.entered

   *Worker*
   - worker.activity.update
   - worker.attributes.update
   - worker.created
   - worker.deleted

# change log

v0.0.1 - initial release
v0.0.2 - added support for agent data, updated readme

## Code of Conduct

Please be aware that this project has a [Code of Conduct](https://github.com/twilio-labs/.github/blob/master/CODE_OF_CONDUCT.md). The tldr; is to just be excellent to each other ❤️

# TODOs
