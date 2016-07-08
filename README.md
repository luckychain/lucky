# lucky-js

Start by cloning this repo and installing dependencies (there may be a few more, which can be determined at runtime):
```
npm install body-parser
npm install cookie-parser
npm install cookie-session
npm install express
npm install cors
npm install request
```
If node.js is not installed on your machine, then install it.

To start, run:
```
npm start
```

Primary files are:
```
server-app.js - Initializes server, calls core-app.js
core-app.js - Fulfills core server functions
```

To test that the server is running, after starting, open a new terminal window and enter:
```
curl localhost:5001/echo?message='hello'
```

The expected output should be similar to:
```
{"message":"hello","datetime":"2016-06-19T01:08:16.979Z"}
```