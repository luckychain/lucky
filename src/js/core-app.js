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
   * Transaction (Payload):
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

  function initializeLocalState() {
    console.log("Initializing...");

    ipfs.id()
    .then((id) => {
      /* IPFS id */
      IPFS_ID = id.ID;
      console.log("IPFS_ID: " + IPFS_ID);

      /* Load local uncommitted transactions state */
      fs.readFile(TRANSACTIONS_DIRECTORY, function (err, res) {
        if (err || res.toString() === "") {
          transactions = { Data: "", Links: [] };
          var transactionsString = JSON.stringify(transactions, null, 2);
          fs.writeFile(TRANSACTIONS_DIRECTORY, transactionsString, null);
        } else {
          transactions = JSON.parse(res.toString());
        }
      });

      /* Load local block (chain head) state */
      fs.readFile(BLOCK_DIRECTORY, function (err, res) {
        if (err || res.toString() === "") {
          var data = JSON.stringify({ luck: -1, attestation: "" });
          block = { Data: data, Links: [{ name: "payload", hash: "GENESIS" }] };
          var blockString = JSON.stringify(block, null, 2);
          fs.writeFile(BLOCK_DIRECTORY, blockString, null);
        } else {
          block = JSON.parse(res.toString());
        }
      });

      /* Discover IPFS peers */
      ipfsPeerID().then(ipfsPeerDiscovery);
      ipfsPeerPublish()
      .then((path) => {
        CRON_ON = true;
        console.log("Successful initialization, starting...");
      });
    })
    .catch((err) => {
      console.log("initializeLocalState error: check that ipfs daemon is running");
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

  function containsObject(obj, array) {
    for (var i = 0; i < array.length; i++) {
      if (equal(obj, array[i])) {
        return true;
      } else if (i === array.length - 1) {
        return false;
      }
    }
  }

  function validData(data, link) {
    if (data === undefined || data === null || data === "") {
      return false;
    }
    else {
      var object = JSON.parse(data);
      if (object.Links === undefined || object.Links === null) {
        return false;
      }
      else if ((link === "/block") && (object.Data === undefined || object.Data === null)) {
        return false;
      }
      else if (link !== "/block" && link !== "/transaction") {
        return false;
      }
      else {
        return true;
      }
    }
  }

/****************************** ERROR HANDLING *******************************/

  function invalidError(res) {
    res.status(400).json({ error: "invalid query params" });
  }

  function invalidTransactionLink(res) {
    res.status(400).json({ error: "invalid transaction submission" });
  }

/****************************** PEER DISCOVERY *******************************/

  function ipfsPeerID() {
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
    return new Promise((resolve) => {
      oboe("http://127.0.0.1:5001/api/v0/dht/findprovs\?arg\=" + hash)
      .done((res) => {
        if (res.Type === 4) {
          var id = res.Responses[0].ID;
          if (id !== IPFS_ID && !_.contains(peers, id)) {
            logger("ipfsPeerDiscovery: " + id);
            ipfsPeerSwarm(id);
          }
        }
      })
      .fail(function() {
        console.log("error: ipfsPeerDiscovery failed to find peers");
      });
    });
  }

  function ipfsPeerSwarm(peerID) {
    ipfs.id(peerID, (err, res) => {
      /* Ignore error case as peer may not exist any more
       * while dht.findprovs still exists. */
      if (!err) {
        console.log("Dialing " + peerID + "...");
        var transports = res.Addresses;
        var connected = false;

        transports.forEach((transport) => {
          var address = transport + "/ipfs/" + peerID;
          ipfs.swarm.connect(address)
          .then((res) => {
            if (!connected && res.Strings[0].indexOf("success") !== -1) {
              console.log("Connected to peer " + peerID);
              connected = true;
              peers.push(peerID);
              peers = _.unique(peers);
            }
          });
        });
      }
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

  /* Called on every pubsub interval */
  function ipfsPeerResolve(id) {
    return new Promise((resolve) => {
      ipfs.name.resolve(id, null, (err, nameRes) => {
        if (err) {
          logger("ipfsPeerResolve error: ipfs.name.resolve failed");
          logger(err);
          logger(id);
        } else resolve(nameRes.Path);
      });
    });
  }

  /* Returns data from IPFS peer path + link */
  function ipfsGetData(path, link) {
    logger("ipfsGetData");
    console.time("getData");
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
            console.timeEnd("getData");
            if (chunks.length > 0) {
              var joinData = chunks.join("");
              if (validData(joinData, link)) {
                joinData = JSON.parse(joinData);
                if (typeof joinData.Link === "string") {
                  joinData.Link = JSON.parse(joinData.Link);
                }
                if (link === "/block" && typeof joinData.Data === "string") {
                  joinData.Data = JSON.parse(joinData.Data);
                }

                logger("---------------------------------------------------------------------------");
                logger("IPFS " + link + " DATA FROM: " + path);
                logger(JSON.stringify(joinData));
                logger("---------------------------------------------------------------------------");
              }
            }
          });
        }
      });
    });
  }

  function ipfsWritePayload(newPayload) {
    logger("ipfsWritePayload");
    return new Promise((resolve) => {
      var payloadBuffer = new Buffer(JSON.stringify(newPayload));
      ipfs.object.put(payloadBuffer, (err, res) => {
        if (err) {
          logger("error: ipfsWritePayload failed");
          logger(err);
          console.log(newPayload);
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
      var blockString = JSON.stringify(newBlock, null, 2);
      fs.writeFile(BLOCK_DIRECTORY, blockString, (err) => {
        if (err) {
          logger("error: ipfsWriteBlock failed");
        } else {
          ipfsPeerPublish();
          resolve();
        }
      });
    });
  }

  function ipfsWriteTransactionLink(newTransactionLink) {
    logger("ipfsWriteTransactionLink");
    return new Promise((resolve) => {
      transactions.Links.push(newTransactionLink);
      var transactionsString = JSON.stringify(transactions, null, 2);
      fs.writeFile(TRANSACTIONS_DIRECTORY, transactionsString, (err) => {
        if (err) {
          logger("error: ipfsWriteTransactionLink failed");
        } else {
          ipfsPeerPublish()
          resolve();
        }
      });
    });
  }

  function ipfsWriteTransactions() {
    logger("ipfsWriteTransactions");
    return new Promise((resolve) => {
      var transactionsString = JSON.stringify(transactions, null, 2);
      fs.writeFile(TRANSACTIONS_DIRECTORY, transactionsString, (err) => {
        if (err) {
          logger("error: ipfsWriteTransactions failed");
        } else {
          ipfsPeerPublish()
          resolve();
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

  /* counter (chain length), array of transactions, */
  function ipfsConstructChain(address) {
    loggger("ipfsConstructChain");
    return new Promise((resolve) => {
      ipfs.object.data(address, { enc: "base58"}, (err, getRes) => {
        if (err) {
          logger("error ipfsBlockIterator: object.get");
          logger(err);
        } else {
          var payload = JSON.parse(getRes.toString());

          var iterations = payload.Links.map((element) => {
            if (element.name === "parent" && element.hash !== "GENESIS") {
              return ipfsBlockIterator(element.hash, counter);
            } else {
              return transactions.Links = transactions.Links.filter((tx) => { 
                return tx.hash !== element.hash;  
              });
            }
          });

          Promise.all(iterations)
          .then((updatedTransactions) => {
            updatedTransactions = _.unique(updatedTransactions);
            console.log("=====================");
            console.log(updatedTransactions);
            resolve(updatedTransactions);
          });
        }
      });
    });
  }



  /* Recursively iterate through all blocks in the chain. */
  function ipfsBlockIterator(blockAddress, job, counter) {
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
        console.log(blockAddress);
        ipfs.object.data(blockAddress, { enc: "base58"}, (err, getRes) => {
          if (err) {
            logger("error ipfsBlockIterator: object.get");
            logger(err);
          } else {
            var payload = JSON.parse(getRes.toString());

            var iterations = payload.Links.map((element) => {
              if (element.name === "parent" && element.hash !== "GENESIS") {
                return ipfsBlockIterator(element.hash, job, counter);
              } else {
                return transactions.Links = transactions.Links.filter((tx) => { 
                  return tx.hash !== element.hash;  
                });
              }
            });

            Promise.all(iterations)
            .then((updatedTransactions) => {
              updatedTransactions = _.unique(updatedTransactions);
              console.log("=====================");
              console.log(updatedTransactions);
              resolve(updatedTransactions);
            });
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
   * Returns true if the transaction address is not already
   * in the array of uncommitted transactions and is not already
   * included in a block, else returns false.
   */
  function validTransactionLink(tx) {
    if (tx === null || tx === undefined) return false;
    else if (tx.name !== 'transaction') return false;
    else if (tx.hash === null || tx.hash === undefined || tx.hash === "GENESIS") return false;
    else if (containsObject(tx, transactions.Links)) return false;
    else if (spentTransaction(tx)) return false;
    else { console.log("passed"); return true; }
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

  function luckierBlock(newBlock, oldBlock) {
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

  function updateChainFromPeer(newChain, newBlock) {
    logger("updateChainFromPeer");

    if (validChain(newChain) && luckier(newChain, chain)) {
      logger("updateChainFromPeer: writing luckier block");
      ipfsWriteBlock(newBlock)
      .then(() => {
        console.log("updateChainFromPeer successful, found luckier block");
        chain = newChain;
        var address = block.Links[0].hash;
        if (address !== "GENESIS") { // Todo
          var counter = 0;
          ipfsBlockIterator(address, "transactions", counter)
          .then((updatedTransactions) => {
            console.log("AAAAAAAAAAAAAAAA " + counter);
            fs.writeFile(TRANSACTIONS_DIRECTORY, JSON.stringify(updatedTransactions, null, 2), (err) => {
              if (err) {
                logger("error: updateChainFromPeer failed");
              } else {
                ipfsPeerPublish();
              }
            });
          });
        }
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
      .then((newBlock) => {
        console.log(newBlock);
        console.log(block);
        if (newBlock.Data.luck > block.Data.luck) {
          var hash = newBlock.Links[0].hash;
          ipfsConstructChain(hash)
          .then((newChain) => {
            updateChainFromPeer(newChain, newBlock);
          });
        }
      });
    });
  }

  function pubSubTransactions() {
    logger("pubSubTransactions");

    var peerPromises = peers.map((peer) => {
      return new Promise((resolve) => {
        ipfsPeerResolve(peer)
        .then((path) => {
          return ipfsGetData(path, "/transactions")
        })
        .then((peerTransactions) => {
          resolve(peerTransactions.Links);
        });
      });
    });

    Promise.all(peerPromises)
    .then((peerTransactions) => {
      var mergedPeerTransactions = [].concat.apply([], peerTransactions);
      mergedPeerTransactions = _.unique(mergedPeerTransactions);

      var validTransactionLinks = mergedPeerTransactions.map((transactionLink) => {
        if (validTransactionLink(transactionLink)) {
          console.log("pubSubTransactions: adding transaction link");
          console.log(JSON.stringify(transactionLink));
          return transactionLink;
        }
      });

      Promise.all(validTransactionLinks)
      .then((newTransactionLinks) => {
        if (newTransactionLinks.length > 0) {
          transactions.Links = _.union(transactions.Links, newTransactionLinks);
          console.log(transactions);
          ipfsWriteTransactions();
        }
      });
    });
  }

  var pubSub = new cron("*/" + PUBSUB_TIME + " * * * * *", function() {
    if (CRON_ON) {
      console.log(LOG_HEAD, "PUBSUB - TIME " + PUBSUB_TIME + " SECONDS", LOG_HEAD);

      pubSubChain();
      pubSubTransactions();
    }
  }, null, true);

/********************************** INTERVAL *********************************/

  /*
   * Construct a new payload and block for commit.
   * Hash the links as the data parameter is determined by the hash of links.
   */
  function commit(newTransactionLinks, callback) {
    logger("commit");

    var newPayload = {
      Data: "",
      Links: newTransactionLinks.slice() // pass by value
    };
    newPayload.Links.push({
      name: "parent",
      hash: block.Links[0].hash
    });

    ipfsWritePayload(newPayload)
    .then((hash) => {
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
    });
  }

  /* Interval Updates */
  var interval = new cron("*/" + ROUND_TIME + " * * * * *", function() {
    if (peers.length === 0) {
      ipfsPeerID().then(ipfsPeerDiscovery);
    }

    if (CRON_ON) {
      console.log(LOG_HEAD, "INTERVAL - TIME: " + ROUND_TIME + " SECONDS", LOG_HEAD);
      console.log("Current list of peers: ");
      console.log(JSON.stringify(peers, null, " "));

      if (transactions.Links.length > COMMIT_THRESHOLD) {
        var newTransactionLinks = transactions.Links.slice();
        transactions.Links = [];
        ipfsWriteTransactions();

        commit(newTransactionLinks, (err, newBlock) => {
          if (err) {
            console.log("Commit failed");
            console.log(err);
            transactions.Links = _.union(newTransactionLinks, transactions.Links);
          } else if (!validChain(newBlock) || !luckierBlock(newBlock, block)) {
            console.log("Commit rejected");
          } else {
            console.log("Commit accepted, writing block...");
            console.log(newBlock);
            ipfsWriteBlock(newBlock)
            .then(() => {
              console.log("Commit successful");
              block = newBlock;
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
    if ((tx !== undefined || tx !== null) && (tx.Data !== undefined || tx.Data !== null)) {
      ipfsWritePayload(tx)
      .then((hash) => {
        var transaction_link = { name: "transaction", hash: hash };
        if (!validTransactionLink(transaction_link)) invalidTransactionLink(res);
        else {
          ipfsWriteTransactionLink(transaction_link)
          .then((path) => {
            console.log("/tx successful");
            var response = { message: "success", datetime: currentTimestamp() };
            res.status(200).json(response);
          });
        }
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

  // function addTransactionTestingOnly(tx) {
  //   return new Promise((resolve) => {
  //     if (validTransaction(tx)) {
  //       ipfsWriteTransactionLink(tx)
  //       .then((name) => {
  //         resolve(transactions);
  //       });
  //     }
  //   });
  // }

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
