# lucky-js

## Build guide

This library has the following system dependencies:

* nodejs
* ipfs
* foreman

Start by installing nodejs:
```
curl -sL https://deb.nodesource.com/setup_5.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Next, install ipfs by [downloading](https://ipfs.io/docs/install/) the package, then run:
```
tar xvfz go-ipfs.tar.gz
mv go-ipfs/ipfs /usr/local/bin/ipfs
```

Next, install foreman:
```
sudo apt-get install rubygems-integration
sudo gem install foreman
```

After installing the aformentioned system dependencies, install the node dependencies:
```
npm install
```

## Start

Start the ipfs daemon:
```
# ipfs init
ipfs daemon
```

For debugging logs, set your environment variable `DEBUG=true`.
```
export DEBUG=true
```

Lastly, start the application:
```
npm start
```

## Development

If you wish to develop on your own ipfs network of peers, go into `storage/id` and change the application id. This is ipfs' point of reference for discovering all application relevant peers.

To test that the server is working, start the application and run:
```
$ curl localhost:5001/echo?message='hello'
{"message":"hello","datetime":"2016-06-19T01:08:16.979Z"}
```

## Directory structure

* server-app.js - Initializes server, calls core-app.js
* core-app.js - Fulfills core server functions
* browser-app.js - Simple front-end interface
