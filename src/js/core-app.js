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
   *     attestation: "<SGX signature>",
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
   *     attestation: "<SGX signature>"
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
  var PUBSUB_TIME = 5; /* Pubsub "polling" interval */
  var COMMIT_THRESHOLD = 0; /* Minimum number of transactions to trigger commit */
  var CRON_ON = false; /* System state */

  /* Storage */
  var STORAGE_DIRECTORY = "storage";
  var ID_DIRECTORY = STORAGE_DIRECTORY + "/id";
  var BLOCK_DIRECTORY = STORAGE_DIRECTORY + "/block";
  var TRANSACTIONS_DIRECTORY = STORAGE_DIRECTORY + "/transactions";

  /* Blockchain */
  var peers = [];
  var block = {};
  var blockHash = "";
  var transactions = {};
  var chain = [];

  /* SGX */
  var sgxInternalCounter = 1;
  var counter = sgxIncrementMonotonicCounter();
  var lastTime = sgxGetTrustedTime();

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
      });

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
                        hash: 'GENESIS',
                        payload: 'GENESIS',
                        parent: 'GENESIS',
                        transactions: [] } ];
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
                ipfsPeerPublish().then((path) => {
                  CRON_ON = true;
                  console.log("Successful initialization, starting...");
                });
              });
            }
          });
        }
      });
    })
    .catch((err) => {
      console.log("initializeLocalState error: check that ipfs daemon is running");
    });
  }

  var LOG_HEAD = "====================================";
  var LOG_DATA = "----------------------------------------------------------------------";

  function printInterval() {
    console.log(LOG_HEAD, "INTERVAL - TIME: " + ROUND_TIME + " SECONDS", LOG_HEAD);
    console.log("Current list of peers: ");
    console.log(JSON.stringify(peers, null, " "));
  }

  function printPubSub() {
    console.log(LOG_HEAD, "PUBSUB - TIME: " + PUBSUB_TIME + " SECONDS", LOG_HEAD);
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

/****************************** ERROR HANDLING *******************************/

  /* Sends an error 400 for invalid query parameter */
  function invalidError(res) {
    res.status(400).json({ error: "invalid query params" });
  }

  /* Sends an error 400 for invalid transaction submission */
  function invalidTransactionLink(res) {
    res.status(400).json({ error: "invalid transaction submission" });
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
      if (!err) {
        console.log("Dialing " + peerID + "...");
        var transports = res.Addresses;
        var connected = false;

        transports.forEach((transport) => {
          var address = transport + "/ipfs/" + peerID;
          ipfs.swarm.connect(address).then((res) => {
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

  /* Publish the files under STORAGE_DIRECTORY using IPNS */
  function ipfsPeerPublish() {
    logger("ipfsPeerPublish");
    return new Promise((resolve) => {
      ipfs.add(STORAGE_DIRECTORY, { recursive: true }, (err, addRes) => {
        if (err) {
          logger("error: ipfsPeerPublish failed");
          logger(err);
        } else {
          var hash = addRes.filter((path) => {
            return path.Name === STORAGE_DIRECTORY;
          })[0].Hash;

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
          logger("ipfsPeerResolve error: ipfs.name.resolve failed for " + id);
          logger(err);
        } else {
          resolve(nameRes.Path);
        }
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
              if (link === "/block" && validObject(data)) {
                var newBlockHash = data;
                ipfs.object.data(newBlockHash, { enc: "base58" }, (err, newData) => {
                  if (err || !validData(newData.toString(), link)) {
                    logger("ipfsGetData error: ipfs.object.data invalid");
                    logger(err);
                  } else {
                    var newBlock = parseIPFSObject(newData.toString());
                    loggerData(newBlock, path, link);
                    resolve({ block: newBlock, blockHash: newBlockHash });
                  }
                });
              } else { /* Transaction data */
                loggerData(data, path, link);
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

  /* Writes the uncommited transactions to local storage and publishes for peers */
  function ipfsWriteTransactions() {
    return new Promise((resolve) => {
      var transactionsString = JSON.stringify(transactions, null, 2);
      fs.writeFile(TRANSACTIONS_DIRECTORY, transactionsString, (err) => {
        if (err) {
          logger("error: ipfsWriteTransactions failed");
          logger(err);
        } else {
          ipfsPeerPublish();
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
          if (err) logger(err);
          else resolve(newChain);
        }
      );
    });
  }

/*********************************** SGX *************************************/

  /* Returns a secure quote from SGX */
  function sgxQuote(report) {
    return { report: report, luck: report.luck };
  }

  /* Returns a secure report from SGX */
  function sgxReport(nonce, luck) {
    return { nonce: nonce, luck: luck };
  }

  /* Returns secure report data from SGX */
  function sgxReportData(data) {
    if (validObject(data)) {
      if (data === "GENESIS") return { nonce: "GENESIS", luck: -1 };
      else {
        if (typeof data === "string") data = JSON.parse(data);
        if (typeof data.report === "string") data.report = JSON.parse(data.report);
        return data.report;
      }
    }
  }

  /* Returns true if SGX proof is valid */
  function sgxValidAttestation(attestation) {
    if (!validObject(attestation)) return false;
    return true;
  }

  /* Returns the trusted system time from SGX */
  function sgxGetTrustedTime() {
    return currentTimestamp();
  }

  /* Returns a random value on request from SGX */
  function sgxGetRandom() {
    var rand = Math.random();
    while (rand === 0) rand = Math.random();
    return 1 / rand;
  }

  /* Generate f(luck), invokes callback after f(luck) time */
  function sgxSleep(luck, callback) {
    var fl = (luck / Number.MAX_VALUE) * ROUND_TIME;
    console.log("sgxSleep: " + fl + " seconds");
    setTimeout(function() {
      callback();
    }, fl);
  }

  /* Returns the internal counter value from SGX */
  function sgxReadMonotonicCounter() {
    return sgxInternalCounter;
  }

  /* Returns the monotonically incremented internal counter value from SGX */
  function sgxIncrementMonotonicCounter() {
    sgxInternalCounter++;
    return sgxInternalCounter;
  }

  /* Returns a proof of luck given a nonce from SGX */
  function sgxProofOfLuck(nonce, callback) {
    var now = sgxGetTrustedTime();
    if (now < lastTime + ROUND_TIME) callback("sgxProofOfLuck error: time", null);
    else {
      lastTime = now;
      var luck = sgxGetRandom();
      sgxSleep(luck, function() {
        console.log("returned from sgxSleep");
        var newCounter = sgxReadMonotonicCounter();
        if (counter !== newCounter) callback("sgxProofOfLuck error: counter", null);
        else callback(null, sgxReport(nonce, luck));
      });
    }
  }

  // function sgxProofOfOwnership(nonce) {
  //   return sgxReport(nonce);
  // }

  // function sgxProofOfTime(nonce, duration) {
  //   sgxSleep(duration, function() {
  //     var newCounter = sgxReadMonotonicCounter();
  //     if (counter === newCounter) {
  //       return sgxReport(nonce, duration);
  //     }
  //   });
  // }


  // function originalProofOfWork(nonce, difficulty) {
  //   /* Todo: determine PoW */
  //   return true;
  // }

  // function originalProofOfWorkSuccess(proofOfWork) {
  //   /* Todo: determine PoW success */
  //   return true;
  // }

  // function sgxProofOfWork(nonce, difficulty) {
  //   var result = originalProofOfWork(nonce, difficulty);
  //   if (originalProofOfWorkSuccess(result)) {
  //     return sgxReport(nonce, difficulty);
  //   }
  // }

/*********************************** PROOF ***********************************/

  /* Returns proof containing attestation and luck */
  function proofOfLuck(nonce, callback) {
    sgxProofOfLuck(nonce, function(err, report) {
      if (err) callback("error: proofOfLuck failed", null);
      else callback(null, sgxQuote(report));
    });
  }

  // function proofOfOwnership(nonce) {
  //   var report = sgxProofOfOwnership(nonce);
  //   return sgxQuote(report, nonce);
  // }

  // function proofOfTime(nonce, duration) {
  //   var report = sgxProofOfTime(nonce, duration);
  //   return sgxQuote(report, null);
  // }

  // function proofOfWork(nonce, difficulty) {
  //   var report = sgxProofOfWork(nonce, difficulty);
  //   return sgxQuote(report, null);
  // }

/********************************** CHAIN ************************************/  

  /* Returns true if tx is contained in current chain - a spent transaction */
  function spentTransaction(tx) {
    for (var i = 0; i < chain.length; i++) {
      if (containsObject(tx, chain[i].transactions)) return true;
      else if (i === chain.length - 1) return false;
    }
  }

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

      if (containsObject(tx, transactions.Links)) return false;
      else if (spentTransaction(tx)) return false;
      else return true;
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

  /* Returns true if the newChain is in accordance to the structure of our specified chain */
  function validChain(newChain) {
    if (!validObject(newChain)) return false;
    else {
      if (typeof newChain === "string") newChain = JSON.parse(newChain);

      var previousBlockHash = "GENESIS";
      var testChain = newChain.slice();
      for (var i = 0; i < testChain.length; i++) {
        var testBlock = testChain[i];
        var report = sgxReportData(testBlock.attestation);
        // dlog(testBlock);
        // dlog(report);

        // logger(!validObject(testBlock))
        // logger(testBlock.parent !== previousBlockHash)
        // logger(!sgxValidAttestation(testBlock.attestation))
        // logger(testBlock.payload !== "GENESIS" && report.nonce !== testBlock.payload)

        if (!validObject(testBlock)) return false;
        else if (testBlock.parent !== previousBlockHash) return false;
        else if (!sgxValidAttestation(testBlock.attestation)) return false;
        else if (testBlock.payload !== "GENESIS" && report.nonce !== testBlock.payload) return false;
        else if (i === testChain.length - 1) return true;
        
        previousBlockHash = testBlock.hash;
      }
    }
  }

  /* Returns the sum of luck values for the given chain */
  function score(thisChain) {
    var score = 0;
    for (var i = 0; i < thisChain.length; i++) {
      var blockData = thisChain[i];
      var report = sgxReportData(blockData.attestation);
      if (blockData.payload !== "GENESIS" && report.luck >= 1) {
        score += report.luck;
      }
      if (i === thisChain.length - 1) return score;
    }
  }

  /* Retruns true if the newChain is luckier than the oldChain */
  function luckier(newChain, oldChain) {
    if (newChain.length < oldChain.length) return false;
    else {
      var newChainPrefixScore = score(newChain.slice(0, oldChain.length));
      var oldChainScore = score(oldChain);
      // dlog("scores: " + newChainPrefixScore + " <= " + oldChainScore);
      // dlog("length: " + newChain.length + " > " + oldChain.length);
      if (newChainPrefixScore > oldChainScore) return false;
      else if (newChainPrefixScore === oldChainScore && newChain.length === oldChain.length) return false;
      else {
        logger("luckier: found luckier block");
        return true;
      }
    }
  }

/********************************** PUBSUB ***********************************/

  function pubSubChain() {
    logger("pubSubChain");

    peers.forEach((peer) => {
      ipfsPeerResolve(peer).then((path) => {
        return ipfsGetData(path, "/block");
      }).then((blockData) => {
        var newBlock = blockData.block;
        var newBlockHash = blockData.blockHash;

        if (!equal(newBlock, block)) {
          logger("pubSubChain: new block from peer");
          ipfsConstructChain(newBlockHash).then((newChain) => {
            /* Check if newChain is luckier than our current chain */
            if (validChain(newChain) && luckier(newChain, chain)) {
              logger("pubSubChain: found luckier block");

              ipfsWriteBlock(newBlock).then((newBlockHash) => {
                console.log("PubSub: Luckier block accepted, writing block...");
                ipfsWriteBlockHash(newBlockHash).then(() => {
                  /* Update uncommitted transactions for new chain */
                  for (var i = 0; i < newChain.length; i++) {
                    var txs = newChain[i].transactions;
                    transactions.Links = _.reject(transactions.Links, function(obj) {
                      return _.find(txs, {luck: obj.luck});
                    });
                    if (i === newChain.length - 1) {
                      ipfsWriteTransactions();
                      block = newBlock;
                      chain = newChain;
                      blockHash = newBlockHash;
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

    /* Get all peer transaction links */
    var peerPromises = peers.map((peer) => {
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
          console.log(transactions);
        }
      });
    });
  }

  var pubSub = new cron("*/" + PUBSUB_TIME + " * * * * *", function() {
    if (CRON_ON) {
      printPubSub();
      pubSubChain();
      pubSubTransactions();
    }
  }, null, true);

/********************************** INTERVAL *********************************/

  /* Construct a new payload and block for commit */
  function commit(newTransactionLinks) {
    logger("commit");
    return new Promise((resolve) => {
      var newPayload = {}
      newPayload.Data = "";
      newPayload.Links = newTransactionLinks.slice();
      newPayload.Links.push({ name: "parent", hash: blockHash });

      ipfsWritePayload(newPayload).then((payloadHash) => {
        var nonce = payloadHash;
        proofOfLuck(nonce, (err, proof) => {
          if (err) throw err;
          else {
            var newBlock = {};
            newBlock.Data = {};
            newBlock.Data.luck = proof.luck;
            newBlock.Data.attestation = proof;
            newBlock.Links = [];
            newBlock.Links.push({ name: "payload", hash: payloadHash });

            ipfsWriteBlock(newBlock)
            .then((newBlockHash) => {
              resolve({ block: newBlock, hash: newBlockHash });
            });
          }
        });
      }).catch((err) => {
        transactions.Links = _.union(newTransactionLinks, transactions.Links);
        ipfsWriteTransactions();
        console.log("Commit failed");
        console.log(err);
      });
    });
  }

  /* Interval Updates - find peers and publish commits */
  var interval = new cron("*/" + ROUND_TIME + " * * * * *", function() {
    // if (peers.length === 0) ipfsPeerID().then(ipfsPeerDiscovery);

    if (CRON_ON) {
      printInterval();

      /* Construct a new commit to update block head */
      if (transactions.Links.length > COMMIT_THRESHOLD) {
        var newTransactionLinks = transactions.Links.slice();
        transactions.Links = [];
        ipfsWriteTransactions();

        commit(newTransactionLinks).then((commitObject) => {
          var newBlock = commitObject.block;
          var newBlockHash = commitObject.hash;
          var newChain = chain.slice();

          var ipfsBlock = {};
          ipfsBlock.luck = newBlock.Data.luck;
          ipfsBlock.attestation = newBlock.Data.attestation;
          ipfsBlock.hash = newBlockHash;
          ipfsBlock.payload = newBlock.Links[0].hash;
          ipfsBlock.parent = blockHash;
          ipfsBlock.transactions = newTransactionLinks;

          newChain.push(ipfsBlock);

          if (!validChain(newChain) || !luckier(newChain, chain)) {
            transactions.Links = _.union(newTransactionLinks, transactions.Links);
            ipfsWriteTransactions();
            console.log("Commit rejected");
          } else {
            console.log("Commit accepted, writing block...");
            console.log(newBlock);

            ipfsWriteBlockHash(newBlockHash).then(() => {
              console.log("Commit successful");
              block = newBlock;
              chain = newChain;
              blockHash = newBlockHash;
            });
          }
        });
      }
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
        if (!validTransactionLink(transaction_link)) invalidTransactionLink(res);
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

  app.get("/", function (req, res, next) {
    res.render("template");
  });

  var server = app.listen(8000, function() {
    console.log("Listening on port %d", server.address().port);
  });

/************************** TESTING INFRASTRUCTURE ***************************/

  app.get("/echo", function (req, res, next) {
    var message = req.query.message; /* Gets parameters from URL */

    if (!validObject(message)) invalidError(res); /* Check that message exists */
    else {
      console.log("echo successful"); /* Print success to console */
      var jsonDate = (new Date()).toJSON(); /* Conforms to JS date format */
      var response = { message: message, datetime: jsonDate }; /* Construct JSON object */
      res.status(200).json(response); /* Send response to client */
    }
  });

/*****************************************************************************/

};

module.exports = coreApp;
