var cron = require('cron').CronJob;
var request = require('request');
var oboe = require('oboe');
var fs = require('fs');
var _ = require('underscore');

var ipfsAPI = require('ipfs-api');
var ipfsLog = require('ipfs-log');

var coreApp = function (options) {
  var app = options.app;

  var ROUND_TIME = 3; /* Time in seconds */

  var CHAIN_DIRECTORY = 'storage/chain';

  var CHAIN_DIRECTORY = 'storage/chain';

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

  function isInArray(value, array) {
    if (value === null || value === undefined) return false;
    if (array === null || array === undefined) return false;
    return array.indexOf(value) > -1;
  }

  function currentTimestamp() {
    return (new Date).getTime();
  }

  /* http://werxltd.com/wp/2010/05/13/javascript-implementation-of-javas-string-hashcode-method/*/
  function fastHash(str) {
    var hash = 0;
    if (str.length == 0) return hash;
    for (i = 0; i < str.length; i++) {
      char = str.charCodeAt(i);
      hash = ((hash<<5)-hash)+char;
      hash = hash & hash; // Convert to 32bit integer
    }
    return hash;
  }

/********************************** BLOCK ************************************/

  function printBlock(block) {
    console.log('Block: \n timestamp: ' + block.timestamp
                + '\n proof: ' + block.proof
                + '\n previous: ' + block.previous
                + '\n transactions: ' + block.transactions);
  }

  function blockHash(block) {
    console.log('blockHash');
    if (block === null || block === undefined) return 0;
    return fastHash(JSON.stringify(block));
  }

  function validTransaction(tx) {
    if (tx === null || tx === undefined) return false;
    else if (tx.inputs === null || tx.inputs === undefined) return false;
    else if (tx.outputs === null || tx.outputs === undefined) return false;
    else if (tx.timestamp === null || tx.timestamp === undefined) return false;
    else return true;
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
    return Math.random();
  }

  function sgxSleep(l, callback) {
    /* Todo: implement f(l) */
    var fl = l;
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
    if (now >= lastTime + ROUND_TIME) {
      lastTime = now;
      l = sgxGetRandom();
      sgxSleep(l, function() {
        console.log('returned from sgxsleep');
        var newCounter = sgxReadMonotonicCounter();
        if (counter === newCounter) {
          callback(null, sgxReport(nonce, l));
        }
        else callback('error: sgxProofOfLuck counter', null);
      });
    }
    else callback('error: sgxProofOfLuck time', null);
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

/*********************************** IPFS ************************************/

  var ipfs = new ipfsAPI('localhost', '5001');
  var log = new ipfsLog(ipfs, 'userid', 'luckychain');

  function logger(message) {
    if (process.env.DEBUG) {
      console.log('# ' + message);
    }
  }

  function ipfsPeerID() {
    logger('ipfsPeerID');
    return new Promise((resolve) => {
      ipfs.add('storage/id', (err, res) => {
        if (err) {
          logger('error: ipfsPeerID failed');
        }
        else {
          var hash = res[0].Hash;
          logger('ipfsPeerID: ' + hash);
          resolve(hash);
        }
      });
    });
  }

  function ipfsPeerDiscovery(hash) {
    logger('ipfsPeerDiscovery');
    return new Promise((resolve) => {
      oboe('http://127.0.0.1:5001/api/v0/dht/findprovs\?arg\=' + hash)
       .done(function(things) {
         if (things.Type === 4) {
           var id = things.Responses[0].ID;
           logger('ipfsPeerDiscovery: ' + id);
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
         console.log('error: ipfsPeerDiscovery failed to find peers');
       });
    });
  }

  function ipfsPeerPublish() {
    logger('ipfsPeerPublish');
    return new Promise((resolve) => {
      ipfs.add('storage', { recursive: true }, (err, res) => {
        if (err) {
          logger('error: ipfsPeerPublish failed');
        }
        var hash = res.pop().Hash;
        ipfs.name.publish(hash, (err, res) => {
          if (err) {
            logger('error: ipfsPeerPublish failed');
          }
          var name = res.Name;
          logger('ipfsPeerPublish: ' + name);
          resolve(name);
        });
      });
    });
  }

  function ipfsPeerResolve(id) {
    logger('ipfsPeerResolve');
    return new Promise((resolve) => {
      ipfs.name.resolve(id, (err, res) => {
        if (err) {
          logger('error: ipfsPeerResolve failed');
        }
        else {
          var path = res.Path;
          logger('ipfsPeerResolve: ' + path);
          resolve(path);
        }
      });
    });
  }

  function ipfsPeerChain(path) {
    logger('ipfsPeerChain');
    return new Promise((resolve) => {
      ipfs.cat(path + '/chain', (err, res) => {
        if (err) {
          logger('error: ipfsPeerChain failed => ');
          console.log(err);
        }
        else {
          var chunks = [];
          res.on('data', function(chunk) {
            chunks.push(chunk);
          });
          res.on('end', function() {
            var results = chunks.join('');
            results = JSON.parse(results);
            logger('ipfsPeerChain: ' + results);
            resolve(results);
          });
        }
      });
    });
  }

  function luckiestChain(chains) {
    var bestChain = chains[0];
    chains.forEach((currChain) => {
      if (validChain(currChain) && luckier(currChain, bestChain)) {
        bestChain = currChain;
      }
    });
    return bestChain;
  }

  function getChainFromPeers(peers) {
    return new Promise((resolve) => {
      var peersPromises = peers.map((peer) => {
        return ipfsPeerResolve(peer).then(ipfsPeerChain);
      })
      Promise.all(peersPromises).then((chains) => {
        var newChain = luckiestChain(chains);
        console.log(newChain);
        resolve(newChain);
      });
    });
  }

  function saveChain(newChain) {
    return new Promise((resolve) => {
      readChain()
      .then((fsChain) => {
        if (validChain(newChain) && luckier(newChain, fsChain)) {
          fs.writeFile(CHAIN_DIRECTORY, JSON.stringify(newChain, null, 2), (err) => {
            if (err) logger('error: saveChain failed');
            else resolve();
          });
        }
      });
    });
  }

  function readChain() {
    return new Promise((resolve) => {
      fs.readFile(CHAIN_DIRECTORY, function (err, data) {
        if (err && err.code === 'ENOENT') {
          fs.writeFile(CHAIN_DIRECTORY, JSON.stringify([], null, 2), (err) => {
            if (err) logger('error: read failed');
            else resolve([]);
          });
        }
        else if (err) {
          logger('error: readChain failed');
        }
        else {
          resolve(JSON.parse(data));
        }
      });
    });
  }

  function writeChain() {
    return new Promise((resolve) => {
      readChain().then((fsChain) => {
        chain.forEach(function(block) {
          fsChain.push(block);
        });

        fsChain = _.unique(fsChain, function(block) {
          return block.proof;
        });

        fs.writeFile(CHAIN_DIRECTORY, JSON.stringify(fsChain, null, 2), (err) => {
          if (err) logger('error: writeChain failed');
          else resolve(fsChain);
        });
      });
    });
  }

  function printChain(chain) {
    return new Promise((resolve) => {
      chain.forEach((block) => {
        printBlock(block);
      });
      resolve();
    });
  }

  function ipfsInit() {
    return new Promise((resolve) => {
      ipfsPeerPublish()
      .then(ipfsPeerID)
      .then(ipfsPeerDiscovery)
      .then(getChainFromPeers)
      .then(saveChain)
      .then(readChain)
      .then((chain) => {
        resolve(chain);
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

  function ipfsUpdateChain() {
    return new Promise((resolve) => {
      getChainFromPeers()
      .then(saveChain)
      .then(readChain)
      .then((chain) => {
        resolve(chain);
      });
    });
  }

  function ipfsWriteChain() {
    logger('ipfsWriteChain');
    return new Promise((resolve) => {
      writeChain()
      .then(ipfsPeerPublish)
      .then((path) => {
        resolve(path);
      });
    });
  }

  function ipfsReadChain() {
    return new Promise((resolve) => {
      ipfsPeerID()
      .then(ipfsPeerDiscovery)
      .then(getChainFromPeers)
      .then(saveChain)
      .then(readChain)
      .then((chain) => {
        resolve(chain);
      });
    });
  }

  ipfsInit();

/********************************** NETWORK **********************************/

  function commit(newTransactions, newChain, callback) {
    var timestamp = currentTimestamp();
    var previousBlock = newChain.length > 0 ? newChain[newChain.length - 1] : 'GENESIS';
    var previous = blockHash(previousBlock);
    var nonce = blockHash({
      previous: previous,
      transactions: newTransactions,
      timestamp: timestamp
    });
    proofOfLuck(nonce, function(err, proof) {
      if (err) callback('error: commit proof of luck', null);
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

  function interval() {
    return new Promise((resolve) => {
      if (transactions === null || transactions === undefined) transactions = [];
      if (transactions.length > 0) {
        var newTransactions = transactions;
        commit(newTransactions, chain, function(err, newChain) {
          if (err) resolve(err, null);
          transactions = [];
          console.log('interval mid');
          if (validChain(newChain) && luckier(newChain, chain)) {
            console.log('Storing new chain: ' + JSON.stringify(newChain));
            chain = newChain;
            ipfsWriteChain((path) => {
              console.log('Stored chain path: ' + path);
              resolve(path);
            });
          }
          else resolve();
        });
      }
      else resolve();
    });
  }

  var job = new cron('*/' + ROUND_TIME + ' * * * * *', function() {
    console.log('interval - ROUND_TIME: ' + ROUND_TIME + ' seconds');
    ipfsUpdatePeers();
    interval();
  }, null, true);
  
  app.post('/tx', function(req, res, next) {
    var tx = req.body.tx;
    if (!validTransaction(tx)) {
      invalidError(res);
    }
    else if (!isInArray(tx, transactions)) {
      transactions.push(tx);
      var jsonDate = (new Date()).toJSON();
      var response = { message: 'success', datetime: jsonDate };
      console.log('/tx successful');
      res.status(200).json(response);
    }
    else {
      invalidTransaction(res);
    }
  });

  app.get('/chain', function (req, res, next) {
    readChain((chain) => {
      var response = { blocks: blocks };
      res.status(200).json(response);
    });
  });

  app.get('/', function (req, res, next) {
    res.render('template');
  });

  var server = app.listen(8000, function() {
    console.log('Listening on port %d', server.address().port);
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
  app.get('/echo', function (req, res, next) {
    var message = req.query.message; // Gets parameters from URL

    if (!message) invalidError(res); // Check that message exists, is not undefined
    else {
      console.log('echo successful'); // Print in server terminal success
      var jsonDate = (new Date()).toJSON(); // Conforms to javascript standard date format
      var response = { message: message, datetime: jsonDate }; // Construct JSON object
      res.status(200).json(response); // Send response to client
    }
  });
  
};

module.exports = coreApp;
