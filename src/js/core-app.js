var async = require("async");
var bs58 = require('bs58');
var cron = require("cron").CronJob;
var equal = require("deep-equal");
var fs = require("fs");
var libp2pIPFS = require('libp2p-ipfs');
var multiaddr = require('multiaddr');
var oboe = require("oboe");
var PeerId = require('peer-id')
var PeerInfo = require('peer-info');
var series = require('run-series');
var _ = require("underscore");

var ipfs = require("ipfs-api");
ipfs = new ipfs("localhost", "5001");

var PSG = require('./pubsub');

var coreApp = function (options) {

/******************************** STRUCTURE **********************************/
  /*
   * Chain: (Internal Use)
   * [
   *   {
   *     luck: 1208,
   *     attestation: "<TEE signature>",
   *     hash: "<address of the block>",
   *     parent: "<address of the parent block>",
   *     transactions: [{
   *       name: "transaction",
   *       hash: "<address of one transaction>",
   *     }, {
   *       name: "transaction",
   *       hash: "<address of one transaction>"
   *     }]
   *   }
   * ]
   *
   * Block:
   * {
   *   Data: {
   *     luck: 1208
   *     attestation: "<TEE signature>"
   *   }
   *   Links: [{
   *     name: "payload",
   *     hash: "<address of the payload>"
   *   }]
   * }
   *
   * Payload: (Block)
   * {
   *   Data: ""
   *   Links: [{
   *       name: "parent",
   *       hash: "<address of parent block>
   *     }, {
   *       name: "transaction",
   *       hash: "<address of one transaction>",
   *     }, {
   *       name: "transaction",
   *       hash: "<address of one transaction>"
   *     }
   *   ]
   * }
   *
   * Transactions: (Uncommitted)
   * {
   *   Data: "",
   *   Links: [{
   *       name: "transaction",
   *       hash: "<address of one transaction>",
   *     }, {
   *       name: "transaction",
   *       hash: "<address of one transaction>",
   *     }, {
   *       name: "transaction",
   *       hash: "<address of one transaction>"
   *     }
   *   ]
   * }
   *
   * Transaction Payload:
   * {
   *    Data: "<content>"
   * }
   */

/****************************** INITIALIZATION *******************************/

  /* Client Parameters */
  var ROUND_TIME = 10; /* Time in seconds */
  var PUBSUB_NUM_PEERS = 5; /* PubSub number of peers to connect to */

  /* Storage */
  var DIRECTORY = "storage";
  var ID_DIRECTORY = DIRECTORY + "/id";
  var PUBSUB_DIRECTORY = DIRECTORY + "/pubsub.json";
  var BLOCK_DIRECTORY = DIRECTORY + "/block";
  var TRANSACTIONS_DIRECTORY = DIRECTORY + "/transactions";

  /* Blockchain */
  var CRON_ON = false; /* System state */
  var roundUpdate = false;
  var block = {};
  var blockHash = "";
  var transactions = {};
  var chain = [];

  /* PubSub */
  var seenBlockHashes = [];
  var pubSubID = {};
  var IPFS_ID = "";
  var p2pnode;
  var pubSub;
  var Peer;

  /* TEE */
  var teeInternalCounter = 1;
  var counter = teeIncrementMonotonicCounter();
  var roundBlock = null;
  var roundBlockParent = null;
  var roundTime = null;

  initializeLocalState();

/***************************** HELPER FUNCTIONS ******************************/

  /* Initializes state of IPFS_ID, peers, block, transactions, and chain */
  function initializeLocalState() {
    ipfs.id().then((id) => {
      /* IPFS daemon id */
      IPFS_ID = id.ID;
      console.log("IPFS_ID: " + IPFS_ID);

      /* Load Pubsub */
      fs.readFile(PUBSUB_DIRECTORY, function (err, res) {
        console.log("Initializing local PubSub state...");
        var ps;
        if (err || !validObject(res.toString())) {
          ps = PeerId.create({ bits: 2048 }).toJSON();
          var id = PeerId.createFromJSON(ps);
          fs.writeFile(PUBSUB_DIRECTORY, JSON.stringify(ps, null, 2), null);
        } else {
          ps = JSON.parse(res.toString());
          var id = PeerId.createFromJSON({ id: ps.id, privKey: ps.privKey, pubKey: ps.pubKey });
        }

        var peer = new PeerInfo(id);
        peer.multiaddr.add(multiaddr('/ip4/0.0.0.0/tcp/10333'));

        p2pnode = new libp2pIPFS.Node(peer);
        p2pnode.start((err) => {
          if (err) throw err;
          console.log('Publisher listening on:');

          ps.addrs = [];
          peer.multiaddrs.forEach((ma) => {
            console.log(ma.toString() + '/ipfs/' + id.toB58String());
            ps.addrs.push(ma.toString() + '/ipfs/' + id.toB58String());
          })
          fs.writeFile(PUBSUB_DIRECTORY, JSON.stringify(ps, null, 2), null);

          ipfsPeerPublish().then((path) => {
            console.log("Successful initialization, starting...");
            // logger(blockHash);
            // logger(JSON.stringify(block, null, " "));
            // logger(JSON.stringify(transactions, null, " "));
            // logger(JSON.stringify(chain, null, " "));

            CRON_ON = true;
          });
          pubSub = new PSG(p2pnode);
          pubSub.subscribe('block');
          pubSub.subscribe('transaction');
          // setInterval(() => {
          //   // process.stdout.write('.')
          //   pubSub.subscribe('block');
          //   pubSub.subscribe('transaction');
          //   pubSub.subscribe('interop');
          //   pubSub.publish('interop', new Buffer('hey im ' + IPFS_ID))
          // }, 300)
          pubSub.on('block', (newBlockHash) => {
            if (newBlockHash.toString() !== blockHash) {
              console.log("@@@@@@@@@@@@@@@@@ RECEIVED NEW BLOCK FROM PEER " + newBlockHash.toString() + " @@@@@@@@@@@@@@@@@@@@@")
              pubSubBlock(newBlockHash);
            }
          });
          pubSub.on('transaction', (link) => {
            pubSubTransaction(link);
          });

          /* Discover IPFS peers */
          ipfsPeerID().then(ipfsPeerDiscovery);

          /* Load local uncommitted transactions state */
          fs.readFile(TRANSACTIONS_DIRECTORY, function (err, res) {
            console.log("Initializing local transactions state...");
            if (err || !validObject(res.toString())) {
              transactions = { Data: "", Links: [] };
              var transactionsString = JSON.stringify(transactions, null, 2);
              fs.writeFile(TRANSACTIONS_DIRECTORY, transactionsString, null);
            } else {
              transactions = JSON.parse(res.toString());
            }

            /* Load local block (chain head) state */
            fs.readFile(BLOCK_DIRECTORY, function (err, res) {
              console.log("Initializing local block state...");
              if (err || !validObject(res.toString())) {
                var data = JSON.stringify({ luck: -1, attestation: "GENESIS" });
                var newBlock = { Data: data, Links: [{ name: "payload", hash: "GENESIS" }] };
                ipfsWriteBlock(newBlock).then((newBlockHash) => {
                  fs.writeFile(BLOCK_DIRECTORY, newBlockHash, null);
                  block = newBlock;
                  blockHash = newBlockHash;
                  chain = [ { luck: -1,
                              attestation: 'GENESIS',
                              hash: blockHash,
                              payload: 'GENESIS',
                              parent: 'GENESIS',
                              transactions: [] } ];
                });
              } else {
                blockHash = res.toString();
                ipfsGetBlock(blockHash).then((newBlock) => {
                  block = parseIPFSObject(newBlock);
                  ipfsConstructChain(blockHash).then((newChain) => {
                    chain = newChain;
                  });
                });
              }
            });
          });
        })
      });
    }).catch((err) => {
      console.log("initializeLocalState error: check that ipfs daemon is running");
      console.log(err);
    });
  }

  var LOG_DATA = "----------------------------------------------------------------------";

  function printInterval() {
    console.log("[----- ROUND TIME: " + ROUND_TIME + " SECONDS -----]");
    console.log("Current list of peers: ");
    console.log(Object.keys(pubSub.getPeerSet()));
  }

  /* Prints debug relevant messages */
  function logger(message, error) {
    if (process.env.DEBUG) {
      console.log("# " + message);
      if (error !== null && error !== undefined && error !== "") {
        console.log(error);
      }
    }
  }

  /* Prints message for internal testing only */
  function dlog(message) {
    console.log(message);
  }

  /* Returns the current timestamp */
  function currentTimestamp() {
    return (new Date).getTime();
  }

  function parseIPFSObject(data) {
    if (typeof data === "string") data = JSON.parse(data);
    if (typeof data.Data === "string") data.Data = JSON.parse(data.Data);
    if (typeof data.Link === "string") data.Link = JSON.parse(data.Link);
    return data;
  }

  /* Returns true if obj is contained in array, otherwise false */
  function containsObject(obj, array) {
    for (var i = 0; i < array.length; i++) {
      if (equal(obj, array[i])) return true;
      else if (i === array.length - 1) return false;
    }
  }

/********************************** PEERS ************************************/

/* Returns the hash identifier for this blockchain application */
  function ipfsPeerID() {
    logger("ipfsPeerID");
    return new Promise((resolve) => {
      ipfs.add(ID_DIRECTORY, (err, res) => {
        if (err) logger("error: ipfsPeerID failed", err);
        else {
          var hash = res[0].Hash;
          logger("ipfsPeerID: " + hash);
          resolve(hash);
        }
      });
    });
  };

  /* Returns the peers who are a part of this blockchain application */
  function ipfsPeerDiscovery(hash) {
    logger("ipfsPeerDiscovery");
    return new Promise((resolve) => {
      oboe("http://127.0.0.1:5001/api/v0/dht/findprovs\?arg\=" + hash).done((res) => {
        if (res.Type === 4) {
          var id = res.Responses[0].ID;
          if (id !== IPFS_ID) {
            ipfsPubSub(id);
            logger("ipfsPeerDiscovery: " + id);
          }
        }
      }).fail(function() {
        console.log("error: ipfsPeerDiscovery failed to find peers");
      });
    });
  };

  /* Returns the resolved path given a peer id - called every pubsub interval */
  function ipfsPeerResolve(id) {
    logger("ipfsPeerResolve");
    return new Promise((resolve) => {
      ipfs.name.resolve(id, null, (err, nameRes) => {
        if (err) logger("ipfsPeerResolve error: " + id, err);
        else resolve(nameRes.Path);
      });
    });
  };

  function ipfsPubSub(peerID) {
    logger("ipfsPubSub");
    ipfsPeerResolve(peerID).then((path) => { return ipfsGetData(path, "/pubsub.json"); }).then((p2pID) => {
      console.log("Dialing " + p2pID.id);
      var id = PeerId.createFromJSON({ id: p2pID.id, privKey: p2pID.privKey, pubKey: p2pID.pubKey });
      var peer = new PeerInfo(id);
      p2pID.addrs.forEach((addr) => {
        peer.multiaddr.add(multiaddr(addr));
      })
      pubSub.connect(peer);
    });
  };

  /* Publish the files under DIRECTORY using IPNS */
  function ipfsPeerPublish() {
    logger("ipfsPeerPublish");
    return new Promise((resolve) => {
      ipfs.add(DIRECTORY, { recursive: true }, (err, addRes) => {
        if (err) logger("error: ipfsPeerPublish failed", err);
        else {
          var hash = addRes.filter((path) => { return path.Name === DIRECTORY; })[0].Hash;
          ipfs.name.publish(hash, null, (err, publishRes) => {
            if (err) logger("ipfsPeerPublish error: ipfs.name.publish failed", err);
            else {
              var name = publishRes.Name;
              logger("ipfsPeerPublish successful: " + name);
              resolve(name);
            }
          });
        }
      });
    });
  };

  /* Returns the requested data given a resolved IPFS path and link */
  function ipfsGetData(path, link) {
    logger("ipfsGetData");
    return new Promise((resolve) => {
      ipfs.cat(path + link, (err, catRes) => {
        if (err) logger("ipfsGetData error: ipfs.cat failed", err);
        else {
          var chunks = [];
          catRes.on("data", (chunk) => { chunks.push(chunk); });
          catRes.on("end", () => {
            if (chunks.length > 0) {
              var data = chunks.join("");
              if (validObject(data)) {
                if (typeof data === "string") data = JSON.parse(data);
                resolve(data);
              }
            }
          })
        }
      })
    })
  };

/*********************************** IPFS ************************************/

  /* Returns the payload given the hash */
  function ipfsGetPayload(hash) {
    return new Promise((resolve) => {
      ipfs.object.data(hash, { enc: "base58" }, (err, data) => {
        if (err) logger("ipfsGetPayload error: ", err);
        else {
          data = data.toString();
          if (validObject(data)) {
            if (typeof data === "string") data = JSON.parse(data);
            if (typeof data.Links === "string") data.Links = JSON.parse(data.Links);
            resolve(data);
          }
        } 
      })
    })
  }

  /* Returns the block given the hash */
  function ipfsGetBlock(hash) {
    return new Promise((resolve) => {
      ipfs.object.data(hash, { enc: "base58" }, (err, data) => {
        if (err) logger("ipfsGetPayload error: ", err);
        else {
          data = data.toString();
          if (validBlock(data)) {
            data = parseIPFSObject(data);
            resolve(data);
          }
        }
      })
    })
  }

  /* Returns the transaction given the hash */
  function ipfsGetTransaction(hash) {
    return new Promise((resolve) => {
      ipfs.object.data(hash, { enc: "base58" }, (err, data) => {
        if (err) logger("ipfsGetPayload error: ", err);
        else {
          data = data.toString();
          if (validTransactionPayload(data)) {
            if (typeof data === "string") data = JSON.parse(data);
            resolve(data);
          }
        }
      })
    })
  }

  /* Returns a hash to the given newPayload */
  function ipfsWritePayload(newPayload) {
    return new Promise((resolve) => {
      ipfs.object.put(new Buffer(JSON.stringify(newPayload)), (err, res) => {
        if (err) logger("error: ipfsWritePayload failed", err);
        else resolve(res.toJSON().Hash);
      });
    });
  }

  /* Returns a hash to the given newBlock */
  function ipfsWriteBlock(newBlock) {
    return new Promise((resolve) => {
      ipfs.object.put(new Buffer(JSON.stringify(newBlock)), (err, res) => {
        if (err) logger("error: ipfsWriteBlock failed", err);
        else resolve(res.toJSON().Hash);
      });
    });
  }

  /* Returns a chain array of custom blocks given the head blockHash of a chain */
  function ipfsConstructChain(headBlockHash) {
    logger("ipfsConstructChain");
    return new Promise((resolve) => {
      var newChain = [];
      var chained = true;
      var nextBlockHash = headBlockHash;

      async.whilst(
        function() { return chained; },
        function(callback) {
          ipfsGetBlock(nextBlockHash).then((newBlock) => {
            nextBlock = parseIPFSObject(newBlock);
            
            var internalBlock = {
              luck: nextBlock.Data.luck,
              attestation: nextBlock.Data.attestation,
              hash: nextBlockHash,
              payload: nextBlock.Links[0].hash,
              parent: "",
              transactions: []
            };

            if (internalBlock.payload === "GENESIS") {
              internalBlock.parent = "GENESIS";
              chained = false;
              newChain.unshift(internalBlock);
              callback(null, newChain);
            } else {
              ipfsGetPayload(internalBlock.payload).then((payload) => {
                for (var i = 0; i < payload.Links.length; i++) {
                  var elem = payload.Links[i];
                  if (elem.name === "parent") internalBlock.parent = elem.hash;
                  else if (elem.name === "transaction" && validTransactionLink(elem)) {
                    internalBlock.transactions.push(elem);
                  }
                  if (i === payload.Links.length - 1) {
                    newChain.unshift(internalBlock);
                    nextBlockHash = internalBlock.parent;
                    callback(null, newChain);
                  }
                }
              });
            }
          });
        },
        function (err, newChain) {
          err ? logger(err) : resolve(newChain);
        }
      );
    });
  }

/********************************** LOCAL ************************************/

  /* Writes the given newBlockHash to local storage */
  function localWriteBlockHash(newBlockHash) {
    return new Promise((resolve) => {
      fs.writeFile(BLOCK_DIRECTORY, newBlockHash, (err) => {
        if (err) logger("error: localWriteBlockHash failed", err);
        else resolve();
      });
    });
  }

  /* Writes the given newTransactionLink to local storage */
  function localWriteTransactionLink(newTransactionLink) {
    return new Promise((resolve) => {
      if (!containsObject(newTransactionLink, transactions.Links)) {
        transactions.Links.push(newTransactionLink);
        fs.writeFile(TRANSACTIONS_DIRECTORY, JSON.stringify(transactions, null, 2), (err) => {
          if (err) logger("error: localWriteTransactionLink failed", err);
          else resolve();
        });
      }
    });
  }

  /* Writes the uncommited transactions to local storage */
  function localWriteTransactions() {
    fs.writeFile(TRANSACTIONS_DIRECTORY, JSON.stringify(transactions, null, 2), (err) => {
      if (err) logger("error: localWriteTransactions failed", err);
      else logger("localWriteTransactions success");
    });
  }

/*********************************** TEE *************************************/

  /* Returns a secure quote from TEE */
  function teeQuote(report) {
    return { report: report, luck: report.luck };
  }

  /* Returns a secure report from TEE */
  function teeReport(nonce, luck) {
    return { nonce: nonce, luck: luck };
  }

  /* Returns secure report data from TEE */
  function teeReportData(data) {
    if (validObject(data)) {
      if (data === "GENESIS") return { nonce: "GENESIS", luck: -1 };
      else if (typeof data === "string") data = JSON.parse(data);
      else return data;
    }
  }

  /* Returns true if TEE proof is valid */
  function teeValidAttestation(attestation) {
    if (!validObject(attestation)) return false;
    return true;
  }

  /* Returns the trusted system time from TEE */
  function teeGetTrustedTime() {
    return currentTimestamp();
  }

  /* Returns a random value on request from TEE */
  function teeGetRandom() {
    var rand = Math.random();
    while (rand === 0) rand = Math.random();
    return 1 / rand;
  }

  /* Returns the internal counter value from TEE */
  function teeReadMonotonicCounter() {
    return teeInternalCounter;
  }

  /* Returns the monotonically incremented internal counter value from TEE */
  function teeIncrementMonotonicCounter() {
    teeInternalCounter++;
    return teeInternalCounter;
  }

/********************************** CHAIN ************************************/

  /* Returns true if obj is defined and has content */
  function validObject(obj) {
    if (obj === null || obj === undefined || obj === "") return false;
    else return true;
  }

  /* Returns true if the array of transaction links contains our defined structure */
  function validTransactionPayload(txp) {
    if (!validObject(txp)) return false;
    else {
      if (typeof txp === "string") txp = JSON.parse(txp);
      return validObject(txp.Data);
    }
  }

  /* Returns true if tx contains our defined structure of a transaction link
   * AND is not in our list of uncommitted transactions or a spent transaction */
  function validTransactionLink(tx) {
    if (tx === null || tx === undefined) return false;
    else if (tx.name !== 'transaction') return false;
    else if (!validObject(tx.hash) || tx.hash === "GENESIS") return false;
    else {
      if (typeof tx === "string") tx = JSON.parse(tx);

      /* Returns false if tx is contained in current chain or transactions */
      if (containsObject(tx, transactions.Links)) return false;
      else for (var i = 0; i < chain.length; i++) {
        if (containsObject(tx, chain[i].transactions)) return false;
        else if (i === chain.length - 1) return true;
      }
    }
  }

  /* Returns true if the array of transaction links contains our defined structure */
  function validTransactions(txs) {
    if (txs === null || txs === undefined) return false;
    else {
      if (typeof txs === "string") txs = JSON.parse(txs);

      if (txs.length === 0) return true;
      for (var i = 0; i < txs.length; i++) {
        if (!validTransactionLink(txs[i])) return false;
        else if (i === txs.length - 1) return true;
      }
    }
  }

  /* Returns true if block b contains our defined structure of a block */
  function validBlock(b) {
    if (!validObject(b)) return false;
    else if (typeof b !== "object" && typeof b !== "string") return false;
    else {
      b = parseIPFSObject(b);
      if (!validObject(b.Data)) return false;
      else if (!validObject(b.Data.luck)) return false;
      else if (!validObject(b.Data.attestation)) return false;
      else if (!validObject(b.Links) || b.Links.length !== 1) return false;
      else if (b.Links[0].name !== "payload") return false;
      else if (!validObject(b.Links[0].hash)) return false;
      else if (b.Links[0].hash !== "GENESIS" && b.Data.luck < 1) return false;
      else return true;
    }
  }

  /* Returns true if payload p contains our defined structure of a payload */
  function validPayload(p) {
    if (!validObject(p)) return false;
    else if (typeof p !== "object" && typeof p !== "string") return false;
    else {
      if (typeof p === "string") p = JSON.parse(p);
      if (typeof p.Links === "string") p.Links = JSON.parse(p.Links);

      if (!validObject(p.Links)) return false;
      else if (p.Links.length < 2) return false;
      else {
        var containsParent = false;
        for (var i = 0; i < p.Links.length; i++) {
          if (p.Links[i].name === "parent") containsParent = true;
          if (i === p.Links.length - 1) return containsParent;
        }
      }
    }
  }

/********************************* ALGORITHM 4 *******************************/

  function teeProofOfLuckRound(thisBlock, thisChain) {
    roundBlock = thisBlock;
    roundBlockParent = thisChain[0].parent;
    roundTime = teeGetTrustedTime();
  }

  function teeProofOfLuckMine(headerParentHash, callback) {
    if (headerParentHash !== blockHash || (chain[0].parent !== roundBlockParent && chain[0].parent !== 'GENESIS')) {
      callback("teeProofOfLuckMine error: header and parent mismatch", null);
    } else {
      var now = teeGetTrustedTime();
      if (now < roundTime + ROUND_TIME) callback("teeProofOfLuckMine error: time", null);
      else {
        // roundBlock = null;
        // roundBlockParent = null;
        // roundTime = null;
        l = teeGetRandom();
        var fl = (l / Number.MAX_VALUE) * ROUND_TIME;
        logger("teeSleep: " + fl + " seconds");

        setTimeout(function() {
          logger("returned from teeSleep");
          var newCounter = teeReadMonotonicCounter();
          var nonce = headerParentHash;
          if (counter !== newCounter) callback("teeProofOfLuckMine error: counter", null);
          else callback(null, teeReport(nonce, l));
        }, fl * 1000);
      }
    } 
  }

/********************************* ALGORITHM 5 *******************************/

  /* Extending a blockchain with a new block. */
  function commit(newTransactionLinks) {
    logger("commit");
    return new Promise((resolve) => {
      var newBlockPayload = { Data: "", Links: newTransactionLinks.slice() };
      newBlockPayload.Links.push({ name: "parent", hash: blockHash });

      ipfsWritePayload(newBlockPayload).then((hash) => {
        teeProofOfLuckMine(blockHash, (err, proof) => {
          if (err) throw err;
          else {
            ipfsWriteBlock({
              Data : { luck: proof.luck, attestation: proof },
              Links: [{ name: "payload", hash: hash }]
            }).then((newBlockHash) => {
              console.log("New Commit: " + newBlockHash);

              transactions.Links = [];
              localWriteTransactions();
              resolve(newBlockHash);
            });
          }
        });
      }).catch((err) => {
        console.log("Commit failed");
        console.log(err);
      });
    });
  }

/********************************* ALGORITHM 6 *******************************/

  /* Computing the luck of a valid blockchain. */
  function luck(thisChain) {
    var totalLuck = 0;
    for (var i = 0; i < thisChain.length; i++) {
      var report = teeReportData(thisChain[i].attestation);
      if (thisChain[i].payload !== "GENESIS" && report.luck >= 1) totalLuck += report.luck;
      if (i === thisChain.length - 1) return totalLuck;
    }
  }

/********************************* ALGORITHM 7 *******************************/

  /* Returns true if the newChain is in accordance to the structure of our specified chain */
  function validChain(newChain) {
    if (!validObject(newChain)) return false;
    else {
      if (typeof newChain === "string") newChain = JSON.parse(newChain);

      var previousBlockHash = "GENESIS";
      var testChain = newChain.slice();
      for (var i = 0; i < testChain.length; i++) {
        var testBlock = testChain[i];
        var report = teeReportData(testBlock.attestation);

        // dlog(testBlock);
        // dlog(report);
        // dlog(!validObject(testBlock))
        // dlog(testBlock.parent !== previousBlockHash)
        // dlog(!teeValidAttestation(testBlock.attestation))
        // dlog(testBlock.payload !== "GENESIS" && report.nonce !== testBlock.parent)

        if (!validObject(testBlock)) return false;
        else if (testBlock.parent !== previousBlockHash) return false;
        else if (!teeValidAttestation(testBlock.attestation)) return false;
        else if (testBlock.payload !== "GENESIS" && report.nonce !== testBlock.parent) return false;
        else if (i === testChain.length - 1) return true;
        
        previousBlockHash = testBlock.hash;
      }
    }
  }

/********************************* ALGORITHM 8 *******************************/

  function newRound(newBlock, newChain) {
    logger("newRound");
    teeProofOfLuckRound(newBlock, newChain);
    resetCallback();
  }

  function pubSubBlock(newBlockHash) {
    logger("pubSubBlock - " + newBlockHash.toString());

    newBlockHash = newBlockHash.toString();
    ipfsGetBlock(newBlockHash).then((newBlock) => {
      if (!containsObject(newBlockHash, seenBlockHashes) && !equal(newBlock, block)) {
        ipfsConstructChain(newBlockHash).then((newChain) => {
          seenBlockHashes.push(newBlockHash);

          /* Check if newChain is valid and luckier than our current chain */
          if (validChain(newChain) && luck(newChain) > luck(chain)) {
            logger("pubSub: found luckier block");

            ipfsWriteBlock(newBlock).then((newBlockHash) => {
              console.log("PubSub: Luckier block accepted, writing block...");

              localWriteBlockHash(newBlockHash).then(() => {
                /* Update uncommitted transactions for new chain */
                for (var i = 0; i < newChain.length; i++) {
                  var txs = newChain[i].transactions;
                  transactions.Links = _.reject(transactions.Links, function(obj) {
                    return _.find(txs, { luck: obj.luck });
                  });
                  if (i === newChain.length - 1) {
                    console.log("PubSub: Block update successful");

                    localWriteTransactions();
                    chain = newChain;
                    block = newBlock;
                    blockHash = newBlockHash;
                    roundUpdate = true;

                    /* Publish it to peers */
                    pubSub.publish('block', new Buffer(newBlockHash));

                    /* Start a new round of mining */
                    if (roundBlock === null || roundBlock === undefined) newRound(newBlock, newChain);
                    else if (newChain[0].parent != roundBlockParent) newRound(newBlock, newChain);
                  }
                }
              })
            })
          }
        })
      }
    })
  }
    
  function pubSubTransaction(link) {
    logger("pubSub: transaction - " + link.toString());

    var txLink = JSON.parse(link.toString());
    if (validTransactionLink(txLink)) {
      ipfsGetTransaction(txLink.hash).then((txPayload) => {
        if (validTransactionPayload(txPayload)) {
          /* Publish it to peers */
          pubSub.publish('transaction', new Buffer(link));
          /* Write it to local state */
          localWriteTransactionLink(txLink).then(() => {
            console.log("pubSub: added transaction link");
          })
        }
      })
    }
  }

  /* Construct a new commit to update block head */
  function resetCallback() {
    var newTransactionLinks = transactions.Links.slice();
    commit(newTransactionLinks).then((newBlockHash) => {
      pubSubBlock(new Buffer(newBlockHash));
    })
  }

  var roundInterval = new cron("*/" + ROUND_TIME + " * * * * *", function() {
    if (CRON_ON) {
      printInterval();
      if (Object.keys(pubSub.getPeerSet()).length === 0) ipfsPeerID().then(ipfsPeerDiscovery);

      if (!roundUpdate) resetCallback();
      roundUpdate = false;
    }
  }, null, true);
  
/********************************** NETWORK **********************************/
  
  var app = options.app;

  app.post("/tx", function(req, res, next) {
    var tx = req.body.tx;
    if (validTransactionPayload(tx)) {
      console.log("/tx request received");
      ipfsWritePayload(tx).then((hash) => {
        logger('/tx payload hash: ' + hash);
        var txLink = { name: "transaction", hash: hash };
        if (!validTransactionLink(txLink)) res.status(400).json({ error: "invalid" });
        else {
          pubSub.publish('transaction', new Buffer(JSON.stringify(txLink)));
          localWriteTransactionLink(txLink).then(() => {
            console.log("/tx request successful");
            res.status(200).json({ message: "success", datetime: currentTimestamp() });
          })
        }
      })
    }
  });

  app.get("/chain", function (req, res, next) {
    res.status(200).json({ chain: chain });
  });

  app.get("/peers", function (req, res, next) {
    res.status(200).json({ peers: Object.keys(pubSub.getPeerSet()) });
  });

  app.get("/", function (req, res, next) {
    res.render("template");
  });

  var server = app.listen(8000, function() {
    console.log("Listening on port %d", server.address().port);
  });

/*****************************************************************************/

};

module.exports = coreApp;
