# lucky-js

## Build guide

This library has the following system dependencies:

* [node.js](https://nodejs.org/): 
  * You can install it from [nodejs.org](https://nodejs.org/en/),
  * or use your system's package,
  * or [Node Version Manager](https://github.com/creationix/nvm).
* [IPFS](https://ipfs.io/)
  * Download the [prebuilt package](https://ipfs.io/docs/install/),
  * then untar the package `tar xvfz go-ipfs.tar.gz`
  * and run `ln -s "$(pwd)/go-ipfs/ipfs" /usr/local/bin/ipfs`.

After installing the aforementioned system dependencies, install the node dependencies in the root of this repository:

```
$ npm install
```

## Start

Initialize IPFS the first time:

```
$ ipfs init
```

Start the IPFS daemon:

```
$ ipfs daemon
```

For debugging logs, set your environment variable `DEBUG=true`.
```
$ export DEBUG=true
```

Lastly, start the application:
```
$ npm start
```

Open the web interface at [http://localhost:8000](http://localhost:8000).

## Development

If you wish to develop on your own blockchain, go into `storage/id` and change the blockchain id.
This is IPFS point of reference for discovering all peers for a blockchain.
