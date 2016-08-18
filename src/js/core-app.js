var cron = require("cron").CronJob;
var request = require("request");
var oboe = require("oboe");
var fs = require("fs");
var _ = require("underscore");
var equal = require("deep-equal");

var ipfsAPI = require("ipfs-api");
var ipfs = new ipfsAPI("localhost", "5001");

var coreApp = function (options) {

/******************************** STRUCTURE **********************************/
  /*
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
   * Payload:
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
   *       hash: "<address of one transaction>",
   *     }, {
   *       name: "transaction",
   *       hash: "<address of one transaction>",
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
   *       hash: "<address of one transaction>",
   *     }
   *   ]
   * }
   *
   * Transaction:
   * {
   *    Data: { tx: <content> }
   * }
   */

/****************************** INITIALIZATION *******************************/

  /* Client Parameters */
  var ROUND_TIME = 10; /* Time in seconds */
  var PUBSUB_TIME = 3; /* Pubsub "polling" interval */
  var COMMIT_THRESHOLD = 0; /* Minimum number of transactions to trigger commit */

  /* Storage */
  var STORAGE_DIRECTORY = "storage";
  var ID_DIRECTORY = STORAGE_DIRECTORY + "/id";
  var BLOCK_DIRECTORY = STORAGE_DIRECTORY + "/block";
  var TRANSACTIONS_DIRECTORY = STORAGE_DIRECTORY + "/transactions";

  /* Blockchain */
  var peers = [];
  var block = {};
  var transactions = {};
  initializeLocalState();

  /* SGX */
  var sgxInternalCounter = 1;
  var counter = sgxIncrementMonotonicCounter();
  var lastTime = sgxGetTrustedTime();

/***************************** HELPER FUNCTIONS ******************************/

  function initializeLocalState() {
    ipfsUpdatePeers();
    ipfsPeerPublish();

    fs.readFile(TRANSACTIONS_DIRECTORY, function (err, res) {
      if (err) {
        transactions = { Data: "", Links: [] };
        var transactions_string = JSON.stringify(transactions, null, 2);
        fs.writeFile(TRANSACTIONS_DIRECTORY, transactions_string, null);
      } else {
        transactions = JSON.parse(res.toString());
      }
    });

    fs.readFile(BLOCK_DIRECTORY, function (err, res) {
      if (err) {
        var data = JSON.stringify({ luck: -1, attestation: "" });
        block = { Data: data, Links: [{ name: "payload", hash: "GENESIS" }] };
        var block_string = JSON.stringify(block, null, 2);
        fs.writeFile(BLOCK_DIRECTORY, block_string, null);
      } else {
        block = JSON.parse(res.toString());
      }
    });
  }

  var LOG_HEAD = "====================================";

  function logger(message) {
    if (process.env.DEBUG) {
      console.log("# " + message);
    }
  }

  function currentTimestamp() {
    return (new Date).getTime();
  }

  function containsObject(obj, list) {
    for (var x in list) {
      if (equal(obj, x)) return true;
    }
    return false;
  }

/****************************** ERROR HANDLING *******************************/

  function invalidError(res) {
    res.status(400).json({ error: "invalid query params" });
  }

  function invalidTransaction(res) {
    res.status(400).json({ error: "invalid transaction submission" });
  }

/****************************** PEER DISCOVERY *******************************/

  function ipfsPeerID() {
    logger("ipfsPeerID");
    return new Promise((resolve) => {
      ipfs.add(ID_DIRECTORY, (err, res) => {
        if (err) {
          logger("error: ipfsPeerID failed");
          logger(err);
        }
        else {
          var hash = res[0].Hash;
          logger("ipfsPeerID: " + hash);
          resolve(hash);
        }
      });
    });
  }

  function ipfsPeerDiscovery(hash) {
    logger("ipfsPeerDiscovery");
    return new Promise((resolve) => {
      oboe("http://127.0.0.1:5001/api/v0/dht/findprovs\?arg\=" + hash)
      .done((things) => {
        if (things.Type === 4) {
          var id = things.Responses[0].ID;
          logger("ipfsPeerDiscovery: " + id);
          peers.push(id);
          peers = _.unique(peers);
        }
      })
      .fail(function() {
        console.log("error: ipfsPeerDiscovery failed to find peers");
      });
    });
  }

/*********************************** IPNS ************************************/

  /* Publish the files under STORAGE_DIRECTORY */
  function ipfsPeerPublish() {
    logger("ipfsPeerPublish");
    return new Promise((resolve) => {
      ipfs.add(STORAGE_DIRECTORY, { recursive: true }, (err, addRes) => {
        if (err) {
          logger("error: ipfsPeerPublish failed");
          logger(err);
          resolve(ipfsPeerPublish());
        } else {
          var hash = addRes.filter((path) => {
            return path.Name === STORAGE_DIRECTORY;
          })[0].Hash;

          ipfs.name.publish(hash, null, (err, publishRes) => {
            if (err) {
              logger("ipfsPeerPublish error: ipfs.name.publish failed");
              logger(err);
              resolve(ipfsPeerPublish());
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

  /* Called on every pubsub interval, so fail silently */
  function ipfsPeerResolve(id) {
    return new Promise((resolve) => {
      ipfs.name.resolve(id, null, (err, nameRes) => {
        if (err) resolve();
        else resolve(nameRes.Path);
      });
    });
  }

  /* Returns data from IPFS peer path + link */
  function ipfsGetData(path, link) {
    logger("ipfsGetData");
    return new Promise((resolve) => {
      ipfs.cat(path + link, (err, catRes) => {
        if (err) {
          logger("error: ipfsGetData failed");
          logger(err);
        }
        else {
          var chunks = [];

          catRes.on("data", (chunk) => {
            chunks.push(chunk);
          });

          catRes.on("end", () => {
            var data = JSON.parse(chunks.join(""));
            logger("---------------------------------------------------------------------------");
            logger("IPFS " + link + " DATA FROM: " + path);
            logger(JSON.stringify(data));
            logger("---------------------------------------------------------------------------");
            resolve(data);
          });
        }
      });
    });
  }

  function ipfsWritePayload(newPayload) {
    logger("ipfsWritePayload");
    return new Promise((resolve) => {
      ipfs.object.put(newPayload, "json", (err, res) => {
        if (err) {
          logger("error: ipfsWritePayload failed");
        } else {
          var hash = res.toJSON().Hash;
          logger("ipfsWritePayload: " + hash);
          resolve(hash);
        }
      });
    });
  }

  function ipfsWriteBlock(newBlock) {
    logger("ipfsWriteBlock");
    return new Promise((resolve) => {
      var block_string = JSON.stringify(newBlock, null, 2);
      fs.writeFile(BLOCK_DIRECTORY, block_string, (err) => {
        if (err) {
          logger("error: ipfsWriteBlock failed");
        } else {
          ipfsPeerPublish()
          .then((name) => {
            resolve(name);
          });
        }
      });
    });
  }

  function ipfsWriteTransaction(newTransaction) {
    logger("ipfsWriteTransaction");
    return new Promise((resolve) => {
      transactions.push(newTransaction);
      var transactions_string = JSON.stringify(transactions, null, 2);
      fs.writeFile(TRANSACTIONS_DIRECTORY, transactions_string, (err) => {
        if (err) {
          logger("error: ipfsWriteTransaction failed");
        } else {
          ipfsPeerPublish()
          .then((name) => {
            resolve(name);
          });
        }
      });
    });
  }


  // /* Recursively check if any transaction matches tx */
  // NEEDS ERROR CHECKING
  // function blockContainsTransaction(blockAddress, tx) {
  //   return new Promise((resolve) => {
  //     ipfs.object.get(blockAddress, "json", (err, res) => {
  //       var block = JSON.parse(res);
  //       block.links.forEach((link) => {
  //         if (link.name === "parent" && link.hash !== "GENESIS") {
  //           if(ipfsBlockIterator(link.hash, tx)) {
  //             resolve(true);
  //           }
  //         }
  //         else if (link.name === "transaction") {
  //           ipfs.object.get(link.hash, "json", (err, res) => {
  //             if (equal(tx, JSON.parse(res))) {
  //               resolve(true);
  //             }
  //           });
  //         }
  //       });
  //     });
  //   });
  // }

  // function chainContainsTransaction(head, tx) {
  //   return new Promise((resolve) => {
  //     head.links.forEach((link) => {
  //       if (link.name === "block") {
  //         resolve(ipfsBlockIterator(link.address, tx));
  //       }
  //     });
  //   });
  // }




  /* Recursively iterate through all blocks in the chain. */
  function ipfsBlockIterator(blockAddress, job) {
    logger("ipfsBlockIterator");
    return new Promise((resolve) => {
      if (job === "chain") {
        // ipfs.object.get(blockAddress, "json", (err, res) => {
        //   if (err) {

        //   } else {
        //     var block = JSON.parse(res);
        //     block.Links.forEach((link) => {
        //       if (link.name === "parent" && link.hash !== "GENESIS") {
        //         ipfsBlockIterator(link.hash, txs);
        //       }
        //       else if (link.name === "transaction") {
        //         ipfs.object.get(link.hash, "json", (err, res) => {
        //           var tx = JSON.parse(res);
        //           txs.push(tx);
        //         });
        //       }
        //     }); // needs promise here
        //     return txs;
        //   }
        // });
      } else if (job === "transactions") {
        ipfs.object.get(blockAddress, "json", (err, getRes) => {
          if (err) {
            logger("error ipfsBlockIterator: object.get");
            logger(err);
          } else {
            var payload = JSON.parse(getRes);

            var iterations = payload.Links.map((element) => {
              if (element.name === "parent" && element.hash !== "GENESIS") {
                ipfsBlockIterator(element.hash, job);
              } else {
                transactions = transactions.filter((tx) => { 
                  return tx.hash !== element.hash;  
                });
              }
            });

            Promise.all(iterations)
            .then(resolve);
          }
        });
      }
    });
  }
  // NEEDS ERROR CHECKING
  //   ipfs.object.get(blockAddress, "json", (err, res) => {
  //     var block = JSON.parse(res);
  //     block.links.forEach((link) => {
  //       if (link.name === "parent" && link.hash !== "GENESIS") {
  //         ipfsBlockIterator(link.hash, txs);
  //       }
  //       else if (link.name === "transaction") {
  //         ipfs.object.get(link.hash, "json", (err, res) => {
  //           var tx = JSON.parse(res);
  //           txs.push(tx);
  //         });
  //       }
  //     }); // needs promise here
  //     return txs;
  //   });
  // }



  // /* Given the head block of a chain, iterate through the blocks. */
  // function ipfsFetchTransactions(head) {
  //   var txs = [];
  //   head.links.forEach((link) => {
  //     if (link.name === "block") {
  //       ipfsBlockIterator(link.address, txs);
  //     }
  //   }); // needs promise here
  //   return txs;
  // }



  // function ipfsConstructChain(block) {

  //   ipfsBlockIterator(block.Links[0].address, "chain")
  //   .then((newChain) => {

  //   });

  //   head.links.forEach((link) => {
  //     if (link[0] === "block") {
  //       ipfsBlockIterator(link.address, txs);
  //     }
  //   }); // needs promise here
  // }



  function ipfsUpdatePeers() {
    return new Promise((resolve) => {
      ipfsPeerID()
      .then(ipfsPeerDiscovery);
    });
  }

/*********************************** SGX *************************************/

  function sgxQuote(report, unused) {
    return { report: report, l: report.l };
  }

  function sgxReport(nonce, l) {
    return {
      report: "",
      data: {
        nonce: nonce,
        l: l
      }
    };
  }

  function sgxReportData(quote) {
    if (quote === null || quote === undefined) return false;
    return { nonce: quote.nonce, l: quote.l };
  }

  // function sgxValidAttestation(proof) {
  //   if (proof === null || proof === undefined) return false;
  //   return true;
  // }


  function sgxGetTrustedTime() {
    return currentTimestamp();
  }

  function sgxGetRandom() {
    var rand = Math.random();
    while (rand === 0) rand = Math.random();
    return 1 / rand;
  }

  function sgxSleep(l, callback) {
    var fl = (l / Number.MAX_VALUE) * ROUND_TIME;
    console.log("sgxSleep: " + fl + " seconds");
    setTimeout(function() {
      callback();
    }, fl);
  }

  function sgxReadMonotonicCounter() {
    return sgxInternalCounter;
  }

  function sgxIncrementMonotonicCounter() {
    sgxInternalCounter++;
    return sgxInternalCounter;
  }

  function sgxProofOfLuck(nonce, callback) {
    var now = sgxGetTrustedTime();
    if (now < lastTime + ROUND_TIME) {
      callback("error: sgxProofOfLuck time", null);
    } else {
      lastTime = now;
      l = sgxGetRandom();
      sgxSleep(l, function() {
        console.log("returned from sgxSleep");
        var newCounter = sgxReadMonotonicCounter();
        if (counter !== newCounter) {
          callback("error: sgxProofOfLuck counter", null);
        } else {
          callback(null, sgxReport(nonce, l));
        }
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

  function proofOfLuck(nonce, callback) {
    sgxProofOfLuck(nonce, function(err, report) {
      if (err) {
        callback("error: proofOfLuck failed", null);
      } else {
        callback(null, sgxQuote(report, null));
      }
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

  function spentTransaction(tx) {
    // Todo: implement check
    return false;
  }

  /* 
   * Returns true if the transaction is not already in the list of uncommitted
   * transactions and is not already included in a block, else returns false.
   */
  function validTransaction(tx) {
    if (tx === null || tx === undefined) return false;
    else if (tx.Data === null || tx.Data === undefined) return false;
    else if (containsObject(tx, transactions.Links)) return false;
    else if (spentTransaction(tx)) return false;
    else return true;
  }

  /* Needs updating to new block setup */
  // function validChain(chain) {
  //   var previousBlock;
  //   var previousTimestamp;

  //   while (chain.length > 0) {
  //     var block = chain.shift();
  //     if (block.previous !== blockHash(previousBlock)) {
  //       return false;
  //     }
  //     else if (!sgxValidAttestation(block.proof)) {
  //       return false;
  //     }
  //     else if (previousTimestamp !== null && block.timestamp <= previousTimestamp + ROUND_TIME) {
  //       return false;
  //     }
  //     else if (timestamp > currentTimestamp + ROUND_TIME) {
  //       return false;
  //     }
  //     else {
  //       var report = sgxReportData(block.proof);
  //       var newBlock = {
  //         previous: block.previous,
  //         transactions: block.transactions,
  //         timestamp: block.timestamp
  //       }
  //       if (report.nonce !== "newblock's address") {
  //         return false;
  //       }
  //       else {
  //         previousBlock = block;
  //         previousTimestamp = timestamp;
  //       }
  //     }
  //   }

  //   return true;
  // }

  function validChain(chain) {
    return true;
  }

  function score(chain) {
    var score = 0;
    for (var i = 0; i < chain.length; i++) {
      var block = chain[i];
      var report = sgxReportData(blockquote);
      score += report.l;
    }
    return score;
  }

  function verifyLuck(newBlock, oldBlock) {
    return new Promise((resolve) => {
      // verify the luck of blocks in newblock and oldblock chains, and count their lengths
      var valid = true;
      var newChainLength = 1;
      var oldChainLength = 1;

      var result = {
        valid: valid,
        newChainLength: newChainLength,
        oldChainLength: oldChainLength
      };
      resolve(result);
    });
  }

  function luckier(newBlock, oldBlock) {
    return new Promise((resolve) => {
      if (newBlock.Data.luck < oldBlock.Data.luck) {
        resolve(false);
      } else {
        verifyLuck(newBlock, oldBlock)
        .then((res) => {
          if (!res.valid) resolve(false);
          else if (res.newChainLength < res.oldChainLength) resolve(false);
          else {
            // var newChainPrefix = newChain.splice(0, res.oldChainLength);
            // var newChainPrefixScore = score(newChainPrefix);
            // var oldChainScore = score(oldChain);
            // if (newChainPrefixScore <= oldChainScore && res.newChainLength > res.oldChainLength) {
            //   return true;
            // }
            // else if (newChainPrefixScore < oldChainScore) {
            //   return true;
            // }
            logger("luckier: found luckier block");
            resolve(true);
          }
        });
      }
    });
  }

  function updateTransactions() {
    logger("updateTransactions");
    var address = block.Links[0].hash;
    if (address !== "GENESIS") {
      ipfsBlockIterator(address, "transactions")
      .then(() => {
        fs.writeFile(TRANSACTIONS_DIRECTORY, JSON.stringify(transactions, null, 2), (err) => {
          if (err) {
            logger("error: updateTransactions failed");
          } else {
            ipfsPeerPublish();
          }
        });
      });
    }   
  }

  function updateChain(newBlock) {
    logger("updateChain");
    if (validChain(newBlock) && luckier(newBlock, block)) {
      logger("updateChain: writing luckier block");

      ipfsWriteBlock(newBlock)
      .then((name) => {
        console.log("updateChain successful, path: " + name);
        block = newBlock;
        updateTransactions();
      });
    }
  }

/********************************** PUBSUB ***********************************/

  function pubSubChain() {
    logger("pubSubChain");
    peers.forEach((peer) => {
      ipfsPeerResolve(peer)
      .then((path) => {
        return ipfsGetData(path, "/block");
      })
      .then((peerBlock) => {
        updateChain(peerBlock);
      });
    });
  }

  function pubSubTransactions() {
    logger("pubSubTransactions");
    var peerPromises = peers.map((peer) => {
      return new Promise((resolve) => {
        ipfsPeerResolve(peer)
        .then((path) => {
          resolve(ipfsGetData(path, "/transactions"));
        });
      });
    });
    Promise.all(peerPromises)
    .then((peerTransactions) => {
      peerTransactions.forEach((peerTransaction) => {
        if (validTransaction(peerTransaction)) {
          logger("pubSubTransactions: adding transaction");
          logger(JSON.stringify(peerTransaction));
          transactions.push(peerTransaction);
        }
      });
    });
  }

  var pubSub = new cron("*/" + PUBSUB_TIME + " * * * * *", function() {
    console.log(LOG_HEAD, "PUBSUB - TIME " + PUBSUB_TIME + " SECONDS", LOG_HEAD);

    pubSubChain();
    pubSubTransactions();
  }, null, true);

/********************************** INTERVAL *********************************/

  /*
   * Construct a new payload and block for commit.
   * Hash the links as the data parameter is determined by the hash of links.
   */
  function commit(callback) {
    var newPayload = transactions;
    newPayload.Links.push({
      name: "parent",
      hash: block.Links[0].hash
    });

    ipfsWritePayload(newPayload, (err, res) => {
      if (err) {
        callback("error commit: ipfsWritePayload", null);
      } else {
        var hash = res.toJSON().Hash;
        var nonce = hash;

        proofOfLuck(nonce, (err, proof) => {
          if (err) {
            callback("error commit: proof of luck", null);
          } else {
            var newBlock = {
              Data: {
                luck: proof.l,
                attestation: proof
              },
              Links: [{
                name: "block",
                hash: hash
              }]
            };
            callback(null, newBlock);
          }
        });
      }
    });
  }

  /* Interval Updates */
  var interval = new cron("*/" + ROUND_TIME + " * * * * *", function() {
    console.log(LOG_HEAD, "INTERVAL - TIME: " + ROUND_TIME + " SECONDS", LOG_HEAD);

    ipfsUpdatePeers();

    if (transactions.length > COMMIT_THRESHOLD) {
      commit((err, newBlock) => {
        if (err) {
          console.log("interval - error");
          console.log(err);
        }
        else updateChain(newBlock, block);
      });
    }
  }, null, true);
  
/********************************** NETWORK **********************************/
  
  var app = options.app;

  app.post("/tx", function(req, res, next) {
    var tx = req.body.tx;
    if (!validTransaction(tx)) invalidTransaction(res);
    else {
      ipfsWriteTransaction(tx)
      .then((name) => {

        console.log("/tx successful");
        var response = { message: "success", datetime: currentTimestamp() };
        res.status(200).json(response);
      });   
    }
  });

  app.get("/", function (req, res, next) {
    res.render("template");
  });

  var server = app.listen(8000, function() {
    console.log("Listening on port %d", server.address().port);
  });

/************************** TESTING INFRASTRUCTURE ***************************/

  function addTransactionTestingOnly(tx) {
    return new Promise((resolve) => {
      if (validTransaction(tx)) {
        ipfsWriteTransaction(tx)
        .then((name) => {
          resolve(transactions);
        });
      }
    });
  }

  /* For testing purposes */
  app.get("/echo", function (req, res, next) {
    var message = req.query.message; // Gets parameters from URL

    if (!message) invalidError(res); // Check that message exists, is not undefined
    else {
      console.log("echo successful"); // Print in server terminal success
      var jsonDate = (new Date()).toJSON(); // Conforms to javascript standard date format
      var response = { message: message, datetime: jsonDate }; // Construct JSON object
      res.status(200).json(response); // Send response to client
    }
  });

/*****************************************************************************/

};

module.exports = coreApp;
