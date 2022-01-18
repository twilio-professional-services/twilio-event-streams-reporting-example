# twilio-flex-event-streams-reporting-example

This project is a node express app that demonstrates processing of event streams data that is then used in an attempt to mirror flex insights reporting

# dependencies

1. Create event streams sink
2. Create event streams subscription for voice (v1) and taskrouter (v2) events

# Deploying to heroku

1. Use this link to begin [![Deploy](https://www.herokucdn.com/deploy/button.svg)](https://heroku.com/deploy?template=https://github.com/jhunter-twilio/twilio-event-streams-reporting-example/tree/main)

2. Populate the given variables when prompted

   - `TWILIO_OUTBOUND_WORKFLOW_SID` - the SID of the workflow you just created - used for creating tasks
   - `TWILIO_ACCOUNT_SID` - the account sid of your twilio account - used for calling Twilio APIs

3. You're all set, the backend is ready. You can access it on https://<HEROKU_APP_NAME>.herokuapp.com

# Deploying locally

1. Clone repository using `git clone`
2. run `npm install`
3. clone the .env.sample to .env
4. update .env as approproate, descriptions above
5. run `ngrok http 3000`
6. start server using `npm start`

# change log

v0.0.1 - initial release

## Code of Conduct

Please be aware that this project has a [Code of Conduct](https://github.com/twilio-labs/.github/blob/master/CODE_OF_CONDUCT.md). The tldr; is to just be excellent to each other ❤️

# TODOs
