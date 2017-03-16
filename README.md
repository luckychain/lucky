# Luckychain

Luckychain is a blockchain [layered on top](http://mitar.tnode.com/post/146227562556/towards-layered-re-decentralized-web)
of [IPFS](https://ipfs.io/). It uses [Intel SGX](https://software.intel.com/en-us/sgx)
capabilities of modern CPUs for Proof of Luck consensus algorithm which allows energy efficient mining.
Transactions can reference arbitrary data of practically unlimited size. A new block is mined on
average every 13 seconds. It is written in JavaScript and uses a [NPM package which allows programs
for SGX enclaves in JavaScript](https://github.com/luckychain/node-secureworker).

Check out its [web interface](https://lucky.tnode.com/) to see it in action.

**Warning: This is a prototype. Do not use it yet for anything important.**

Current implementation uses mock SGX implementation without any of the security assurances of the SGX platform.
Help finalizing the [NPM package with full SGX support is welcome](https://github.com/luckychain/node-secureworker).

## Build guide

This library has the following system dependencies:

* [node.js](https://nodejs.org/) (tested with v6.10.0): 
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
$ ipfs daemon --enable-pubsub-experiment
```

Lastly, start the application:
```
$ npm start
```

Open the web interface at [http://localhost:8000](http://localhost:8000).

## Docker

You can use [Docker to run Luckychain](https://hub.docker.com/r/luckychain/luckychain/):

```
docker run -d -p 4001:4001/tcp -p 4002:4002/udp -p 8000:8000/tcp --name luckychain luckychain/luckychain
```

## Whitepaper

The whitepaper describing Proof of luck consensus protocol and Luckychain blockchain was published in
SysTEX '16 Proceedings of the 1st Workshop on System Software for Trusted Execution,
[DOI 10.1145/3007788.3007790](http://dx.doi.org/10.1145/3007788.3007790).

Available at:

* https://dl.acm.org/citation.cfm?id=3007790

Abstract:

> In the paper, we present designs for multiple blockchain consensus primitives and a novel blockchain
> system, all based on the use of trusted execution environments (TEEs), such as Intel SGX-enabled CPUs.
> First, we show how using TEEs for existing proof of work schemes can make mining equitably distributed
> by preventing the use of ASICs. Next, we extend the design with proof of time and proof of ownership
> consensus primitives to make mining energy- and time-efficient. Further improving on these designs,
> we present a blockchain using a proof of luck consensus protocol. Our proof of luck blockchain uses
> a TEE platform's random number generation to choose a consensus leader, which offers low-latency
> transaction validation, deterministic confirmation time, negligible energy consumption, and equitably
> distributed mining. Lastly, we discuss a potential protection against up to a constant number of
> compromised TEEs.

You can cite it as:

```
@inproceedings{Milutinovic2016,
 author = {Milutinovic, Mitar and He, Warren and Wu, Howard and Kanwal, Maxinder},
 title = {Proof of Luck: An Efficient Blockchain Consensus Protocol},
 booktitle = {Proceedings of the 1st Workshop on System Software for Trusted Execution},
 series = {SysTEX '16},
 year = {2016},
 isbn = {978-1-4503-4670-2},
 location = {Trento, Italy},
 pages = {2:1--2:6},
 articleno = {2},
 numpages = {6},
 url = {http://doi.acm.org/10.1145/3007788.3007790},
 doi = {10.1145/3007788.3007790},
 acmid = {3007790},
 publisher = {ACM},
 address = {New York, NY, USA},
 keywords = {Blockchain, Consensus Protocol, Intel SGX, Trusted Execution Environments},
} 
```
