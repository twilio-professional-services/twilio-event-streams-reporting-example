# twilio-flex-event-streams-reporting-example

This project is a node express app that demonstrates processing of event streams data that is then used to model data as it appears in flex insights reporting

# Disclaimer

This project is provided 'as is' to demonstrate how data can be transformed and is not provided as a production ready solution.  It comes with no warranty and no support and it is not designed for scale. Anyone using this project should consider challenges with consuming events out of order and at large volumes.

# Deploying to heroku

1. Use this link to begin [![Deploy](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy?template=https://github.com/jhunter-twilio/twilio-event-streams-reporting-example/tree/main)

2. Populate the given variables when prompted


   - `TWILIO_ACCOUNT_SID` - the account sid of your twilio account - used for calling Twilio APIs //TODO
   - `TWILIO_AUTH_TOKEN` - the auth token for your twilio account - used for the authentication of requests //TODO
   - `LOCALE` - Locale as setup in flex insights eg en-US
   - `TIMEZONE` - Timezone of flex insights eg "UTC" or "America/New_York"

3. You're all set, the backend is ready. You can access it on https://<HEROKU_APP_NAME>.herokuapp.com

# Deploying locally

1. Clone repository using `git clone https://github.com/jhunter-twilio/twilio-event-streams-reporting-example.git`
2. run `npm install`
3. clone the .env.sample to .env
4. update .env as approproate, descriptions above
5. run `ngrok http -subdomain=<preferred-subdomain> 3000`
6. start server using `npm start`

# dependencies

1. Create event streams sink to point to either your heroku `https://<HEROKU_APP_NAME>.herokuapp.com/events` or ngrok domain `https://<subdomain>.ngrok.io/events`
2. Create event streams subscription for taskrouter (v2) events

   - task-queue.entered
   - task.transfer-initiated
   - reservation.created
   - reservation.accepted
   - reservation.rejected
   - reservation.timeout
   - reservation.canceled
   - reservation.rescinded
   - reservation.wrapup
   - reservation.completed
   - task.canceled
   - task.transfer-failed

# change log

v0.0.1 - initial release

## Code of Conduct

Please be aware that this project has a [Code of Conduct](https://github.com/twilio-labs/.github/blob/master/CODE_OF_CONDUCT.md). The tldr; is to just be excellent to each other ❤️

# TODOs
