var cron = require('cron').CronJob;
var ipfs = require('ipfs');
var request = require('request');

var coreApp = function (options) {
  var app = options.app;
  
  var node = new ipfs();

  var ROUND_TIME = 1; /* Expressed in seconds */

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

  function invalidChain(res) {
    res.status(400).json({ error: "invalid chain submission "});
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

  function validTransaction(tx) {
    if (tx === null || tx === undefined) return false;
    else if (tx.inputs === null || tx.inputs === undefined) return false;
    else if (tx.outputs === null || tx.outputs === undefined) return false;
    else if (tx.timestamp === null || tx.timestamp === undefined) return false;
    else return true;
  }

/********************************** BLOCK ************************************/

  function newBlock(previous, newTransactions, timestamp, proof) {
    var block = {
      previous: previous,
      transactions: newTransactions,
      timestamp: timestamp,
      proof: proof
    };
    return block;
  }

  function blockHash(block) {
    if (block === null || block === undefined) return 0;
    return fashHash(JSON.stringify(block));
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

  function sgxProofOfLuck(nonce) {
    var now = sgxGetTrustedTime();
    if (now >= lastTime + ROUND_TIME) {
      lastTime = now;
      l = sgxGetRandom();
      sgxSleep(l, function() {
        var newCounter = sgxReadMonotonicCounter();
        if (counter === newCounter) {
          return sgxReport(nonce, l);
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

  function proofOfLuck(nonce) {
    var report = sgxProofOfLuck(nonce);
    return sgxQuote(report, null);
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

  function luckier(newChain, oldChain) {
    if (newChain.length >= oldChain.length) {
      var newChainPrefix = newChain.splice(0, oldChain.length);
      var newChainPrefixScore = score(newChainPrefix);
      var oldChainScore = score(oldChain);
      if (newChainPrefixScore <= oldChainScore && newChain.length > oldChain.length) {
        return true;
      }
      else if (newChainPrefixScore < oldChainScore) {
        return true;
      }
    }
    return false;
  }

  function validChain(chain) {
    var previousBlock;
    var previousTimestamp;

    while (chain.length > 0) {
      var block = chain.shift();
      if (block.previous !== blockHash(previousBlock)) {
        return false;
      }
      else if (!sgxValidAttestation(block.proof)) {
        return false;
      }
      else if (previousTimestamp !== null && block.timestamp <= previousTimestamp + ROUND_TIME) {
        return false;
      }
      else if (timestamp > currentTimestamp + ROUND_TIME) {
        return false;
      }
      else {
        var report = sgxReportData(block.proof);
        var newBlock = newBlock(block.previous, block.transactions, block.timestamp);
        if (report.nonce !== blockHash(newBlock)) {
          return false;
        }
        else {
          previousBlock = block;
          previousTimestamp = timestamp;
        }
      }
    }

    return true;
  }

/********************************** NETWORK **********************************/

  function storeAndBroadcastTransaction(tx) {
    node.object.put(tx, function(err, res) {
      if (err) console.log(err);
      else {
        res = res.toJSON();
        tx = {
          key: res.Hash,
          data: res.Data,
          links: res.Links,
          size: res.Size
        };
        transactions.push(tx);
        console.log('Storing transaction: ' + JSON.stringify(tx));
        for (var i = 0; i < peers.length; i++) {
          var peer = peers[i];
          console.log('Broadcasting transaction to peer: ' + peer);
          // Todo: peer.broadcastTransaction(tx);
        }
      }
    });
  }

  function broadcastChain(chain) {
    for (var i = 0; i < peers.length; i++) {
      var peer = peers[i];
      console.log('Broadcasting chain to peer: ' + peer);
      // Todo: peer.broadcastChain(chain);
    }
  }

  function processChain(newChain) {
    if (validChain(newChain) && luckier(newChain, chain)) {
      console.log('Storing new chain: ' + JSON.stringify(newChain));
      chain = newChain;
      broadcastChain(chain);
      return true;
    }
    else {
      return false;
    }
  }

  function commit(newTransactions, chain) {
    var timestamp = currentTimestamp();
    var previousBlock = chain[chain.length - 1];
    var previous = blockHash(previousBlock);
    var nonce = blockHash(newBlock(previous, newTransactions, timestamp));
    var proof = proofOfLuck(nonce);
    var newBlock = newBlock(previous, newTransactions, timestamp, proof);
    chain.push(newBlock);
    return chain;
  }

  function interval() {
    if (transactions === null || transactions === undefined) transactions = [];
    if (transactions.length > 0) {
      var newTransactions = transactions;
      transactions = [];
      var newChain = commit(newTransactions, chain);
      processChain(newChain);
    }
  }

  var job = new cron(ROUND_TIME + ' * * * * * *', function() {
    console.log('interval(ROUND_TIME)');
    interval();
  }, null, true);
  

  app.get('/tx', function(req, res, next) {
    var tx = req.query.tx;
    if (!validTransaction(tx)) {
      invalidError(res);
    }
    else if (!isInArray(tx, transactions)) {
      storeAndBroadcastTransaction(tx);
      var jsonDate = (new Date()).toJSON();
      var response = { message: 'success', datetime: jsonDate };
      res.status(200).json(response);
    }
    else {
      invalidTransaction(res);
    }
  });

  app.get('/chain', function(req, res, next) {
    var newChain = req.query.chain;
    if (newChain === null || newChain === undefined) {
      invalidError(res);
    }
    if (processChain(newChain)) {
      var jsonDate = (new Date()).toJSON();
      var response = { message: 'success', datetime: jsonDate };
      res.status(200).json(response);
    }
    else {
      invalidChain(res);
    }
  });

/****************************** INFRASTRUCTURE *******************************/

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

  app.get('/', function (req, res, next) {
    res.render('template');
  });

  var server = app.listen(5001, function() {
    console.log('Listening on port %d', server.address().port);
  });

};

module.exports = coreApp;
