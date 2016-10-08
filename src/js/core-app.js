var async = require("async");
var cron = require("cron").CronJob;
var equal = require("deep-equal");
var fs = require("fs");
var oboe = require("oboe");
var _ = require("underscore");

var ipfs = require("ipfs-api");
ipfs = new ipfs("localhost", "5001");

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
  var ROUND_TIME = 15; /* Time in seconds */
  var PUBSUB_TIME = 5; /* Pubsub "polling" interval */
  var PUBSUB_QUERY_PEERS = 5; /* Pubsub number of peers to connect to */

  /* Storage */
  var DIRECTORY = "storage";
  var ID_DIRECTORY = DIRECTORY + "/id";
  var BLOCK_DIRECTORY = DIRECTORY + "/block";
  var TRANSACTIONS_DIRECTORY = DIRECTORY + "/transactions";

  /* Blockchain */
  var CRON_ON = false; /* System state */
  var peers = [];
  var block = {};
  var blockHash = "";
  var transactions = {};
  var chain = [];

  /* PubSub */
  var seenBlockHashes = [];

  /* TEE */
  var teeInternalCounter = 1;
  var counter = teeIncrementMonotonicCounter();
  var roundBlock = null;
  var roundTime = null;

  /* IPFS */
  var IPFS_ID = "";
  initializeLocalState();

/***************************** HELPER FUNCTIONS ******************************/

  /* Initializes state of IPFS_ID, peers, block, transactions, and chain */
  function initializeLocalState() {
    ipfs.id().then((id) => {
      /* IPFS daemon id */
      IPFS_ID = id.ID;
      console.log("IPFS_ID: " + IPFS_ID);

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
              console.log("Publishing local state...");
              ipfsPeerPublish().then((path) => {
                CRON_ON = true;
                console.log("Successful initialization, starting...");
              });
            });
          } else {
            blockHash = res.toString();
            ipfs.object.data(blockHash, { enc: "base58" }, (err, newBlock) => {
              if (err || !validData(newBlock.toString(), "/block")) {
                logger("initializeLocalState error: ipfs.object.data failed");
                logger(err);
              } else {
                block = parseIPFSObject(newBlock.toString());
                ipfsConstructChain(blockHash).then((newChain) => {
                  chain = newChain;
                  console.log("Publishing local state...");
                  ipfsPeerPublish().then((path) => {
                    CRON_ON = true;
                    console.log("Successful initialization, starting...");
                  });
                });
              }
            });
          }
        });
      });
    })
    .catch((err) => {
      console.log("initializeLocalState error: check that ipfs daemon is running");
    });
  }

  var LOG_DATA = "----------------------------------------------------------------------";

  function printInterval() {
    console.log("<===== ROUND - TIME: " + ROUND_TIME + " SECONDS =====>");
    console.log("Current list of peers: ");
    console.log(JSON.stringify(peers, null, " "));
  }

  function printPubSub() {
    console.log("<=== PUBSUB - TIME: " + PUBSUB_TIME + " SECONDS ===>");
  }

  /* Prints debug relevant messages */
  function logger(message) {
    if (process.env.DEBUG) console.log("# " + message);
  }

  /* Prints ipfsGetData results in a clean manner */
  function loggerData(data, path, link) {
    logger(LOG_DATA);
    logger("IPFS DATA " + path + link);
    logger(JSON.stringify(data));
    logger(LOG_DATA);
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

/****************************** PEER DISCOVERY *******************************/

  /* Returns the hash identifier for this blockchain application */
  function ipfsPeerID() {
    return new Promise((resolve) => {
      ipfs.add(ID_DIRECTORY, (err, res) => {
        if (err) {
          logger("error: ipfsPeerID failed");
          logger(err);
        } else {
          var hash = res[0].Hash;
          logger("ipfsPeerID: " + hash);
          resolve(hash);
        }
      });
    });
  }

  /* Returns the peers who are a part of this blockchain application */
  function ipfsPeerDiscovery(hash) {
    return new Promise((resolve) => {
      oboe("http://127.0.0.1:5001/api/v0/dht/findprovs\?arg\=" + hash)
      .done((res) => {
        if (res.Type === 4) {
          var id = res.Responses[0].ID;
          if (id !== IPFS_ID && !_.contains(peers, id)) {
            ipfsPeerSwarm(id);
            logger("ipfsPeerDiscovery: " + id);
          }
        }
      })
      .fail(function() {
        console.log("error: ipfsPeerDiscovery failed to find peers");
      });
    });
  }

  /* Attempts to directly connect to peers running this blockchain application */
  function ipfsPeerSwarm(peerID) {
    /* Ignore error as peer may no longer exist while dht.findprovs still exists. */
    ipfs.id(peerID, (err, res) => {
      if (!err && validObject(res.Addresses)) {
        console.log("Dialing " + peerID + "...");
        var transports = res.Addresses;
        var connected = false;

        transports.forEach((transport) => {
          ipfs.swarm.connect(transport + "/ipfs/" + peerID).then((res) => {
            if (!connected && res.Strings[0].indexOf("success") !== -1) {
              connected = true;
              peers.push(peerID);
              peers = _.unique(peers);
              console.log("Connected to peer " + peerID);
            }
          });
        });
      }
    });
  }

/*********************************** IPNS ************************************/

  /* Publish the files under DIRECTORY using IPNS */
  function ipfsPeerPublish() {
    logger("ipfsPeerPublish");
    return new Promise((resolve) => {
      ipfs.add(DIRECTORY, { recursive: true }, (err, addRes) => {
        if (err) {
          logger("error: ipfsPeerPublish failed");
          logger(err);
        } else {
          var hash = addRes.filter((path) => { return path.Name === DIRECTORY; })[0].Hash;
          ipfs.name.publish(hash, null, (err, publishRes) => {
            if (err) {
              logger("ipfsPeerPublish error: ipfs.name.publish failed");
              logger(err);
            } else {
              var name = publishRes.Name;
              logger("ipfsPeerPublish successful: " + name);
              resolve(name);
            }
          });
        }
      });
    });
  }

  /* Returns the resolved path given a peer id - called every pubsub interval */
  function ipfsPeerResolve(id) {
    return new Promise((resolve) => {
      ipfs.name.resolve(id, null, (err, nameRes) => {
        if (err) {
          peers = _.without(peers, id);
          logger("ipfsPeerResolve error: ipfs.name.resolve failed for " + id);
          logger(err);
        } else resolve(nameRes.Path);
      });
    });
  }

  /* Returns the requested data given a resolved IPFS path and link */
  function ipfsGetData(path, link) {
    return new Promise((resolve) => {
      ipfs.cat(path + link, (err, catRes) => {
        if (err) {
          logger("ipfsGetData error: ipfs.cat failed");
          logger(err);
        } else {
          var chunks = [];
          catRes.on("data", (chunk) => { chunks.push(chunk); });
          catRes.on("end", () => {
            if (chunks.length > 0) {
              var data = chunks.join("");
              if (link === "/block"
                  && validObject(data)
                  && !containsObject(newBlockHash, seenBlockHashes)) {
                var newBlockHash = data;
                ipfs.object.data(newBlockHash, { enc: "base58" }, (err, newData) => {
                  if (err || !validData(newData.toString(), link)) {
                    logger("ipfsGetData error: ipfs.object.data invalid");
                    logger(err);
                  } else {
                    var newBlock = parseIPFSObject(newData.toString());
                    // loggerData(newBlock, path, link);
                    resolve({ block: newBlock, blockHash: newBlockHash });
                  }
                });
              } else if (link === "/transactions") { /* Transaction data */
                // loggerData(data, path, link);
                if (validData(data, link)) {
                  if (typeof data === "string") data = JSON.parse(data);
                  resolve(data);
                }
              }
            }
          });
        }
      });
    });
  }

  /* Returns a hash to the given newPayload */
  function ipfsWritePayload(newPayload) {
    return new Promise((resolve) => {
      var payloadBuffer = new Buffer(JSON.stringify(newPayload));
      ipfs.object.put(payloadBuffer, (err, res) => {
        if (err) {
          logger("error: ipfsWritePayload failed");
          logger(err);
        } else {
          var hash = res.toJSON().Hash;
          logger("ipfsWritePayload: " + hash);
          resolve(hash);
        }
      });
    });
  }

  /* Returns a hash to the given newBlock */
  function ipfsWriteBlock(newBlock) {
    return new Promise((resolve) => {
      var blockBuffer = new Buffer(JSON.stringify(newBlock));
      ipfs.object.put(blockBuffer, (err, res) => {
        if (err) {
          logger("error: ipfsWriteBlock failed");
          logger(err);
        } else {
          var hash = res.toJSON().Hash;
          logger("ipfsWriteBlock: " + hash);
          resolve(hash);
        }
      });
    });
  }

  /* Writes the given newBlockHash to local storage and publishes for peers */
  function ipfsWriteBlockHash(newBlockHash) {
    return new Promise((resolve) => {
      fs.writeFile(BLOCK_DIRECTORY, newBlockHash, (err) => {
        if (err) {
          logger("error: ipfsWriteBlockHash failed");
          logger(err);
        } else {
          ipfsPeerPublish();
          logger("ipfsWriteBlockHash publish");
          resolve();
        }
      });
    });
  }

  /* Writes the given newTransactionLink to local storage and publishes for peers */
  function ipfsWriteTransactionLink(newTransactionLink) {
    return new Promise((resolve) => {
      transactions.Links.push(newTransactionLink);
      var transactionsString = JSON.stringify(transactions, null, 2);
      fs.writeFile(TRANSACTIONS_DIRECTORY, transactionsString, (err) => {
        if (err) {
          logger("error: ipfsWriteTransactionLink failed");
          logger(err);
        } else {
          ipfsPeerPublish();
          logger("ipfsWriteTransactionLink publish");
          resolve();
        }
      });
    });
  }

  /* Writes the uncommited transactions to local storage */
  function ipfsWriteTransactions() {
    return new Promise((resolve) => {
      var transactionsString = JSON.stringify(transactions, null, 2);
      fs.writeFile(TRANSACTIONS_DIRECTORY, transactionsString, (err) => {
        if (err) {
          logger("error: ipfsWriteTransactions failed");
          logger(err);
        } else {
          logger("ipfsWriteTransactions publish");
          resolve();
        }
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
          ipfs.object.data(nextBlockHash, { enc: "base58" }, (err, newBlock) => {
            if (err || !validData(newBlock.toString(), "/block")) {
              chained = false;
              callback("ipfsConstructChain error: ipfs.object.data failed, " + err, null);
            } else {
              nextBlock = parseIPFSObject(newBlock.toString());
              
              var ipfsBlock = {};
              ipfsBlock.luck = nextBlock.Data.luck;
              ipfsBlock.attestation = nextBlock.Data.attestation;
              ipfsBlock.hash = nextBlockHash;
              ipfsBlock.payload = nextBlock.Links[0].hash; /* Block payload */
              ipfsBlock.parent = "";
              ipfsBlock.transactions = [];

              if (ipfsBlock.payload === "GENESIS") {
                ipfsBlock.parent = "GENESIS";
                chained = false;
                newChain.unshift(ipfsBlock);
                callback(null, newChain);
              } else {
                ipfs.object.data(ipfsBlock.payload, { enc: "base58" }, (err, load) => {
                  if (err || !validPayload(load.toString())) {
                    chained = false;
                    callback("ipfsConstructChain error: payload failed, " + err, null);
                  } else {
                    load = load.toString();
                    if (typeof load === "string") load = JSON.parse(load);
                    if (typeof load.Links === "string") load.Links = JSON.parse(load.Links);

                    for (var i = 0; i < load.Links.length; i++) {
                      var elem = load.Links[i];
                      if (elem.name === "parent") ipfsBlock.parent = elem.hash;
                      else if (elem.name === "transaction" && validTransactionLink(elem)) {
                        ipfsBlock.transactions.push(elem);
                      }

                      if (i === load.Links.length - 1) {
                        newChain.unshift(ipfsBlock);
                        nextBlockHash = ipfsBlock.parent;
                        callback(null, newChain);
                      }
                    }
                  }
                });
              }
            }
          });
        },
        function (err, newChain) {
          err ? logger(err) : resolve(newChain);
        }
      );
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
      else {
        if (typeof data === "string") data = JSON.parse(data);
        if (typeof data.report === "string") data.report = JSON.parse(data.report);
        return data.report;
      }
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

  /* Returns true if the data is in accordance to the structure of the specified link */
  function validData(data, link) {
    if (!validObject(data)) return false;
    else if (link !== "/block" && link !== "/transaction") return false;
    else {
      if (typeof data === "string") data = JSON.parse(data);

      if (data.Links === undefined || data.Links === null) return false;
      else if (link === "/block") return validBlock(data);
      else if (link === "/transaction") return validTransactions(data.Links);
    }
  }

/********************************* ALGORITHM 4 *******************************/

  function teeProofOfLuckRound(thisBlock) {
    roundBlock = thisblock;
    roundTime = teeGetTrustedTime();
  }

  function teeProofOfLuckMine(header, previousBlock, callback) {
    if (header.parent !== previousBlock.hash || previousBlock.parent !== roundBlock.parent) {
      callback("teeProofOfLuckMine error: header and parent mismatch", null);
    } else {
      var now = teeGetTrustedTime();
      if (now < roundTime + ROUND_TIME) callback("teeProofOfLuckMine error: time", null);
      else {
        roundBlock = null;
        roundTime = null;
        l = teeGetRandom();
        var fl = (luck / Number.MAX_VALUE) * ROUND_TIME;
        console.log("teeSleep: " + fl + " seconds");

        setTimeout(function() {
          console.log("returned from teeSleep");
          var newCounter = teeReadMonotonicCounter();
          var nonce = header.hash;
          if (counter !== newCounter) callback("teeProofOfLuckMine error: counter", null);
          else callback(null, teeReport(nonce, luck));
        }, fl * 1000);
      }
    } 
  }

/********************************* ALGORITHM 5 *******************************/

  /* Extending a blockchain with a new block. */
  function commit(newTransactionLinks) {
    logger("commit");
    return new Promise((resolve) => {
      var newPayload = {};
      newPayload.Data = "";
      newPayload.Links = newTransactionLinks.slice();
      newPayload.Links.push({ name: "parent", hash: blockHash });

      ipfsWritePayload(newPayload).then((nonce) => {
        teeProofOfLuckMine(nonce, (err, proof) => {
          if (err) throw err;
          else {
            console.log("Commit accepted, writing block...");
            var newBlock = {
              Data : { luck: proof.luck, attestation: proof },
              Links: [{ name: "payload", hash: nonce }]
            };
            console.log(newBlock);

            ipfsWriteBlock(newBlock).then((newBlockHash) => {
              chain.push({
                luck: newBlock.Data.luck,
                attestation: newBlock.Data.attestation,
                hash: newBlockHash,
                payload: newBlock.Links[0].hash,
                parent: blockHash,
                transactions: newTransactionLinks
              });

              ipfsWriteBlockHash(newBlockHash).then(() => {
                console.log("Commit successful");
                block = newBlock;
                blockHash = newBlockHash;
              });

              transactions.Links = [];
              ipfsWriteTransactions();
              resolve();
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
        // dlog(testBlock.payload !== "GENESIS" && report.nonce !== testBlock.payload)

        if (!validObject(testBlock)) return false;
        else if (testBlock.parent !== previousBlockHash) return false;
        else if (!teeValidAttestation(testBlock.attestation)) return false;
        else if (testBlock.payload !== "GENESIS" && report.nonce !== testBlock.payload) return false;
        else if (i === testChain.length - 1) return true;
        
        previousBlockHash = testBlock.hash;
      }
    }
  }

/********************************* ALGORITHM 8 *******************************/

  function newRound(newChain) {
    teeProofOfLuckRound(block);
    resetCallback(ROUND_TIME);
  }

  function pubSubChain() {
    logger("pubSubChain");

    peers.slice(0, PUBSUB_QUERY_PEERS).forEach((peer) => {
      ipfsPeerResolve(peer).then((path) => { return ipfsGetData(path, "/block"); }).then((data) => {
        var newBlock = data.block;
        var newBlockHash = data.blockHash;

        if (!containsObject(newBlockHash, seenBlockHashes) && !equal(newBlock, block)) {
          logger("pubSubChain: received new block from peer");
          ipfsConstructChain(newBlockHash).then((newChain) => {
            seenBlockHashes.push(newBlockHash);

            /* Check if newChain is valid and luckier than our current chain */
            if (validChain(newChain) && luck(newChain) > luck(oldChain)) {
              logger("pubSubChain: found luckier block");

              ipfsWriteBlock(newBlock).then((newBlockHash) => {
                console.log("PubSub: Luckier block accepted, writing block...");
                ipfsWriteBlockHash(newBlockHash).then(() => {
                  /* Update uncommitted transactions for new chain */
                  for (var i = 0; i < newChain.length; i++) {
                    var txs = newChain[i].transactions;
                    transactions.Links = _.reject(transactions.Links, function(obj) {
                      return _.find(txs, { luck: obj.luck });
                    });
                    if (i === newChain.length - 1) {
                      ipfsWriteTransactions();
                      ipfsPeerPublish();
                      chain = newChain;
                      /* Start a new round of mining */
                      if (roundBlock === null || roundBlock === undefined) newRound(newChain);
                      else {
                        block = newBlock;
                        blockHash = newBlockHash;
                        if (block.parent != roundBlock.parent) newRound(newChain);
                      }
                      console.log("PubSub: Block update successful");
                    }
                  }
                });
              });
            }
          });
        }
      });
    });
  }

  function pubSubTransactions() {
    logger("pubSubTransactions");

    /* Get peer transaction links */
    var pubSubPeers = peers.slice(0, PUBSUB_QUERY_PEERS);
    var peerPromises = pubSubPeers.map((peer) => {
      return new Promise((resolve) => {
        ipfsPeerResolve(peer).then((path) => {
          return ipfsGetData(path, "/transactions")
        }).then((peerTransactions) => {
          resolve(peerTransactions.Links);
        });
      });
    });

    Promise.all(peerPromises).then((peerTransactions) => {
      var mergedPeerTransactions = [].concat.apply([], peerTransactions);
      mergedPeerTransactions = _.unique(mergedPeerTransactions);

      /* Merge valid transaction links into one array */
      var transactionLinks = mergedPeerTransactions.map((transactionLink) => {
        if (validTransactionLink(transactionLink)) {
          console.log("pubSubTransactions: adding transaction link");
          console.log(JSON.stringify(transactionLink));
          return transactionLink;
        }
      });

      /* Write valid transaction links to transactions file */
      Promise.all(transactionLinks).then((newTransactionLinks) => {
        if (newTransactionLinks.length > 0) {
          transactions.Links = _.union(transactions.Links, newTransactionLinks);
          ipfsWriteTransactions();
          ipfsPeerPublish();
          console.log(transactions);
        }
      });
    });
  }

  /* Construct a new commit to update block head */
  function resetCallback() {
    var newTransactionLinks = transactions.Links.slice();
    commit(newTransactionLinks).then(() => {
      console.log("callback updated");
    });
  }

  var pubSub = new cron("*/" + PUBSUB_TIME + " * * * * *", function() {
    if (CRON_ON) {
      printPubSub();
      pubSubChain();
      pubSubTransactions();
    }
  }, null, true);

  var interval = new cron("*/" + ROUND_TIME + " * * * * *", function() {
    if (CRON_ON) {
      printInterval();
      if (peers.length === 0) ipfsPeerID().then(ipfsPeerDiscovery);
    }
  }, null, true);
  
/********************************** NETWORK **********************************/
  
  var app = options.app;

  app.post("/tx", function(req, res, next) {
    var tx = req.body.tx;
    if (validTransactionPayload(tx)) {
      console.log("/tx request received");

      ipfsWritePayload(tx).then((hash) => {
        var transaction_link = { name: "transaction", hash: hash };
        if (!validTransactionLink(transaction_link)) {
          res.status(400).json({ error: "invalid transaction submission" });
        }
        else ipfsWriteTransactionLink(transaction_link).then((path) => {
          console.log("/tx request successful");
          var response = { message: "success", datetime: currentTimestamp() };
          res.status(200).json(response);
        });
      });
    }
  });

  app.get("/chain", function (req, res, next) {
    res.status(200).json({ chain: chain });
  });

  app.get("/peers", function (req, res, next) {
    res.status(200).json({ peers: peers });
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
