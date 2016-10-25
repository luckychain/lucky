# lucky-js

## Build guide

This library has the following system dependencies:

* nodejs
* ipfs

Start by installing nodejs:
```
curl -sL https://deb.nodesource.com/setup_5.x | sudo -E bash -
sudo apt-get install -y nodejs
```

Next, install ipfs with one of two options:

1. Download the [prebuilt package](https://ipfs.io/docs/install/), then untar the package `tar xvfz go-ipfs.tar.gz` and run `mv go-ipfs/ipfs /usr/local/bin/ipfs`.
2. Download [go-ipfs-v0.4.3-rc3](https://github.com/howardwu/go-ipfs-v0.4.3-rc3), then follow the install procedure as outlined in the README. Remember to set the correct path to this installation, for example:
```
export GOPATH=$HOME/work
export PATH=$PATH:$GOPATH/bin
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

In the case that IPFS has issues managing files, it is likely due to a low limit for open files. To increase the number of open file descriptors, run `ulimit -n 2560`. To check that it worked, `run ulimit -a`.

## Development

If you wish to develop on your own ipfs network of peers, go into `storage/id` and change the application id. This is ipfs' point of reference for discovering all application relevant peers.

To test that the server is working, start the application and run:
```
$ curl localhost:8000/echo?message='hello'
{"message":"hello","datetime":"2016-06-19T01:08:16.979Z"}
```
