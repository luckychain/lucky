var cron = require("cron").CronJob;
var request = require("request");
var oboe = require("oboe");
var fs = require("fs");
var _ = require("underscore");
var equal = require("deep-equal");

var ipfsAPI = require("ipfs-api");
var ipfs = new ipfsAPI("localhost", "5001");

// var ipfsLog = require("ipfs-log");
// var log = new ipfsLog(ipfs, "userid", "luckychain");

var coreApp = function (options) {
  /*
   * Header + Block:
   * {
   *   data: {
   *     luckynumber: 34,
   *     attestition: "<sgx signature>"
   *   }
   *   links: [{
   *     name: "block",
   *     address: "<address of the block>"
   *   }]
   * }
   *
   * Block:
   * {
   *   links: [{
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
   */

  /* Parameters */
  var COMMIT_THRESHOLD = 0; /* Minimum number of transactions to trigger commit */
  var ROUND_TIME = 5; /* Time in seconds */
  var CHAIN_DIRECTORY = "storage/chain";

  var peers = [];
  var chain = [];
  var transactions = [];

  /* SGX */
  var sgxInternalCounter = 1;
  var counter = sgxIncrementMonotonicCounter();
  var lastTime = sgxGetTrustedTime();

/****************************** ERROR HANDLING *******************************/

  function invalidError(res) {
    res.status(400).json({ error: "invalid query params" });
  }

  function invalidTransaction(res) {
    res.status(400).json({ error: "invalid transaction submission" });
  }

/***************************** HELPER FUNCTIONS ******************************/

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

  /* http://werxltd.com/wp/2010/05/13/javascript-implementation-of-javas-string-hashcode-method/*/
  function fastHash(str) {
    var hash = 0;
    if (str.length == 0) return hash;
    for (i = 0; i < str.length; i++) {
      char = str.charCodeAt(i);
      hash = ((hash<<5)-hash)+char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash;
  }

/********************************** BLOCK ************************************/

  function printBlock(block) {
    console.log("Block: \n timestamp: " + block.timestamp
                + "\n proof: " + block.proof
                + "\n previous: " + block.previous
                + "\n transactions: " + block.transactions);
  }

  function blockHash(block) {
    console.log("blockHash");
    if (block === null || block === undefined) return 0;
    return fastHash(JSON.stringify(block));
  }

  /* 
   * Returns true if the transaction is not already in the list of uncommitted
   * transactions and is not already included in a block, else returns false.
   */
  function validTransaction(tx) {
    if (tx === null || tx === undefined) return false;
    else if (containsObject(tx, transactions)) return false;
    else {
      // if ()

      return true;
    }
  }

/*********************************** SGX *************************************/

  function sgxQuote(report, unused) {
    /* Todo: find out SGX quote return items */
    return report;
  }

  function sgxReport(nonce, l) {
    return { nonce: nonce, l: l };
  }

  function sgxReportData(quote) {
    if (quote === null || quote === undefined) return false;
    return { nonce: 1, l: 1 };
  }

  function sgxValidAttestation(proof) {
    if (proof === null || proof === undefined) return false;
    return true;
  }

  function sgxGetTrustedTime() {
    return currentTimestamp();
  }

  function sgxGetRandom() {
    var rand = Math.random();
    while (rand === 0) rand = Math.random();
    return 1 / rand;
  }

  function sgxSleep(l, callback) {
    var fl = (l / Number.MAX_VALUE) * ROUND_TIME; // f(l)
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
        console.log("returned from sgxsleep");
        var newCounter = sgxReadMonotonicCounter();
        if (counter !== newCounter) {
          callback("error: sgxProofOfLuck counter", null);
        } else {
          callback(null, sgxReport(nonce, l));
        }
      });
    }
  }

  function sgxProofOfOwnership(nonce) {
    return sgxReport(nonce);
  }

  function sgxProofOfTime(nonce, duration) {
    sgxSleep(duration, function() {
      var newCounter = sgxReadMonotonicCounter();
      if (counter === newCounter) {
        return sgxReport(nonce, duration);
      }
    });
  }

  function sgxProofOfWork(nonce, difficulty) {
    var result = originalProofOfWork(nonce, difficulty);
    if (originalProofOfWorkSuccess(result)) {
      return sgxReport(nonce, difficulty);
    }
  }

/******************************** ALGORITHMS *********************************/

  function originalProofOfWork(nonce, difficulty) {
    /* Todo: determine PoW */
    return true;
  }

  function originalProofOfWorkSuccess(proofOfWork) {
    /* Todo: determine PoW success */
    return true;
  }

  function score(chain) {
    var score = 0;
    for (var i = 0; i < chain.length; i++) {
      var block = chain[i];
      var report = sgxReportData(block.quote);
      score = score + report.l;
    }
    return score;
  }

  function proofOfLuck(nonce, callback) {
    sgxProofOfLuck(nonce, function(err, report) {
      if (!err) {
        callback(null, sgxQuote(report, null));
      }
    });
  }

  function proofOfOwnership(nonce) {
    var report = sgxProofOfOwnership(nonce);
    return sgxQuote(report, nonce);
  }

  function proofOfTime(nonce, duration) {
    var report = sgxProofOfTime(nonce, duration);
    return sgxQuote(report, null);
  }

  function proofOfWork(nonce, difficulty) {
    var report = sgxProofOfWork(nonce, difficulty);
    return sgxQuote(report, null);
  }

  // function luckier(newChain, oldChain) {
  //   if (newChain.length >= oldChain.length) {
  //     var newChainPrefix = newChain.splice(0, oldChain.length);
  //     var newChainPrefixScore = score(newChainPrefix);
  //     var oldChainScore = score(oldChain);
  //     if (newChainPrefixScore <= oldChainScore && newChain.length > oldChain.length) {
  //       return true;
  //     }
  //     else if (newChainPrefixScore < oldChainScore) {
  //       return true;
  //     }
  //   }
  //   return false;
  // }

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
  //       if (report.nonce !== blockHash(newBlock)) {
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

  function luckier(newChain, oldChain) {
    return true;
  }

  function validChain(chain) {
    return true;
  }

/****************************** IPFS DISCOVERY *******************************/

  function ipfsPeerID() {
    logger("ipfsPeerID");
    return new Promise((resolve) => {
      ipfs.add("storage/id", (err, res) => {
        if (err) logger("error: ipfsPeerID failed");
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
      .done(function(things) {
        if (things.Type === 4) {
          var id = things.Responses[0].ID;
          logger("ipfsPeerDiscovery: " + id);
          peers.push(id);
        }
        if (things.Extra === "routing: not found") {
          peers = _.unique(peers, function(x) {
            return x.timestamp;
          });
          resolve(peers);
        }
      })
      .fail(function() {
        console.log("error: ipfsPeerDiscovery failed to find peers");
      });
    });
  }

/*********************************** IPNS ************************************/

  function ipfsPeerPublish() {
    logger("ipfsPeerPublish");
    return new Promise((resolve) => {
      ipfs.add("storage", { recursive: true }, (err, res) => {
        if (err) logger("error: ipfsPeerPublish failed");
        else {
          var hash = res.pop().Hash;
          ipfs.name.publish(hash, (err, res) => {
            if (err) logger("error: ipfsPeerPublish failed");
            var name = res.Name;
            logger("ipfsPeerPublish: " + name);
            resolve(name);
          });
        }
      });
    });
  }

  function ipfsPeerResolve(id) {
    logger("ipfsPeerResolve");
    return new Promise((resolve) => {
      ipfs.name.resolve(id, (err, res) => {
        if (err) logger("error: ipfsPeerResolve failed");
        else {
          logger("ipfsPeerResolve: " + res.Path);
          resolve(res.Path);
        }
      });
    });
  }

  /* Returns data from ipfs peer, expects path of form /ipfs/<peer>/<data> */
  function ipfsGetData(path) {
    logger("ipfsGetData");
    return new Promise((resolve) => {
      ipfs.cat(path + "/chain", (err, res) => {
        if (err) {
          logger("error: ipfsGetData failed => ");
          console.log(err);
        }
        else {
          var chunks = [];
          res.on("data", function(chunk) { chunks.push(chunk); });
          res.on("end", function() {
            var results = JSON.parse(chunks.join(" "));
            var hash = results.Hash;
            ipfs.object.get(hash, (err, res) => {
              res = JSON.parse(res);
              logger("ipfsGetData: " + res);
              resolve(res);
            });
          });
        }
      });
    });
  }

  /* Recursively check if any transaction matches tx */
  function blockContainsTransaction(blockAddress, tx) {
    return new Promise((resolve) => {
      ipfs.object.get(blockAddress, "json", (err, res) => {
        var block = JSON.parse(res);
        block.links.forEach((link) => {
          if (link.name === "parent" && link.hash !== "GENESIS") {
            if(ipfsBlockIterator(link.hash, tx)) {
              resolve(true);
            }
          }
          else if (link.name === "transaction") {
            ipfs.object.get(link.hash, "json", (err, res) => {
              if (equal(tx, JSON.parse(res))) {
                resolve(true);
              }
            });
          }
        });
      });
    });
  }

  function chainContainsTransaction(head, tx) {
    return new Promise((resolve) => {
      head.links.forEach((link) => {
        if (link.name === "block") {
          resolve(ipfsBlockIterator(link.address, tx));
        }
      });
    });
  }

  // /* Recursively collect all transactions from this blockchain. */
  // function ipfsBlockIterator(blockAddress, txs) {
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
  //     });
  //   });
  // }

  // /* Given the head block of a chain, iterate through the blocks. */
  // function ipfsChainIterator(head) {
  //   var txs = [];
  //   head.links.forEach((link) => {
  //     if (link.name === "block") {
  //       ipfsBlockIterator(link.address, txs);
  //     }
  //   });
  // }

  function ipfsWriteChain(chain) {
    logger("ipfsWriteChain");
    return new Promise((resolve) => {
      fs.readFile(CHAIN_DIRECTORY, function (err, data) {
        if (!err) {
          var ipChain = { "Data": chain, "Links": [{ "Hash": JSON.parse(data).Hash }] };
          fs.writeFile(CHAIN_DIRECTORY, JSON.stringify(ipChain, null, 2), (err) => {
            if (err) logger("error: ipfsWriteChain failed");
            else {
              ipfs.object.put(CHAIN_DIRECTORY, "json", (err, res) => {
                fs.writeFile(CHAIN_DIRECTORY, JSON.stringify(res, null, 2), (err) => {
                  if (err) logger("error: ipfsWriteChain failed");
                  else {
                    ipfsPeerPublish();
                    resolve();
                  }
                });
              });
            }
          });
        }
      });
    });
  }

  function ipfsUpdatePeers() {
    return new Promise((resolve) => {
      ipfsPeerID()
      .then(ipfsPeerDiscovery)
      .then((peers) => {
        resolve(peers);
      });
    });
  }

  ipfsPeerPublish();
  ipfsUpdatePeers();

/********************************** PUBSUB ***********************************/

  function pubSubChain() {
    var peerPromises = peers.map((peer) => {
      return ipfsPeerResolve(peer).then((peer) => {
        ipfsGetData(peer + "/chain");
      });
    });
    Promise.all(peerPromises)
    .then((peerChains) => {
      peerChains.forEach((peerChain) => {
        var updated = false;
        if (validChain(peerChain) && luckier(peerChain, chain)) {
          updated = true;
          chain = currChain;
        }
      });
      resolve(updated);
    })
    .then((updated) => {
      if (updated) console.log("pubSubChain: updated head block");
    });
  }

  function pubSubTransactions() {
    var peerPromises = peers.map((peer) => {
      return ipfsPeerResolve(peer).then((peer) => {
        ipfsGetData(peer + "/transactions");
      });
    });
    Promise.all(peerPromises)
    .then((peerTransactions) => {
      peerTransactions.forEach((peerTransaction) => {
        if (validTransaction(peerTransaction)) {
          transactions.push(peerTransaction);
        }
      });
    });
  }

  var pubSub = new cron("*/" + ROUND_TIME + " * * * * *", function() {
    console.log("pubSub updates");
    pubSubChain();
    pubSubTransactions();
  }, null, true);

/********************************** INTERVAL *********************************/

  /* Commit transactions to a block */
  function commit(newTransactions, newChain, callback) {
    var timestamp = currentTimestamp();
    var previousBlock = newChain.length > 0 ? newChain[newChain.length - 1] : "GENESIS";
    var previous = blockHash(previousBlock);
    var nonce = blockHash({
      previous: previous,
      transactions: newTransactions,
      timestamp: timestamp
    });
    
    /* Individually publish transactions */

    proofOfLuck(nonce, function(err, proof) {
      if (err) callback("error: commit proof of luck", null);
      else {
        newChain.push({
          previous: previous,
          transactions: newTransactions,
          timestamp: timestamp,
          proof: proof
        });
        callback(null, newChain);
      }
    });
  }

  /* Interval Updates */
  var interval = new cron("*/" + ROUND_TIME + " * * * * *", function() {
    console.log("interval - ROUND_TIME: " + ROUND_TIME + " seconds");
    ipfsUpdatePeers();

    if (transactions.length > COMMIT_THRESHOLD) {
      commit(transactions, chain, function(err, newChain) {
        if (err) resolve(err, null);
        else if (validChain(newChain) && luckier(newChain, chain)) {
          console.log("Storing new chain: " + JSON.stringify(newChain));
          chain = newChain;
          transactions = [];
          ipfsWriteChain(chain, (path) => {
            console.log("Stored chain path: " + path);
            resolve(path);
          });
        }
      });
    }
  }, null, true);
  
/********************************** NETWORK **********************************/
  
  var app = options.app;

  app.post("/tx", function(req, res, next) {
    var tx = req.body.tx;
    if (!validTransaction(tx)) invalidError(res);
    else if (!containsObject(tx, transactions)) {
      transactions.push(tx);
      var response = { message: "success", datetime: (new Date()).toJSON() };
      console.log("/tx successful");
      res.status(200).json(response);
    }
    else invalidTransaction(res);
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
        transactions.push(tx);
      }
      resolve(transactions);
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
