var cron = require('cron').CronJob;
// var ipfs = require('ipfs');
var request = require('request');

// var BlockService = require('ipfs-block-service');
// var Block = require('ipfs-block');
// var IPFSRepo = require('ipfs-repo');
// var memstore = require('abstract-blob-store');
// var mh = require('multihashes');

// var node = new ipfs();

var ipfsAPI = require('ipfs-api');
var ipfsLog = require('ipfs-log');

var coreApp = function (options) {
  var app = options.app;

  var ROUND_TIME = '3'; /* Time in seconds */

  var peers = [];
  var chain = [];
  var transactions = [];

  /* SGX */
  var sgxInternalCounter = 1;
  var counter = sgxIncrementMonotonicCounter();
  var lastTime = sgxGetTrustedTime();

/*********************************** IPFS ************************************/

  var ndjson = require('ndjson');
  var oboe = require('oboe');
  var fs = require('fs');
  var _ = require('underscore');

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

  function ipfsCatParser(string, name, callback) {
    var firstLine = string.split('\n')[0];
    var choices = string.split(firstLine);

    var prototype = "Content-Disposition: file; filename=\"" + name + "\"";
    var innerPrototype = "octet-stream";
    for (var i = 0; i < choices.length; i++) {
      if (choices[i].indexOf(prototype) > -1) {
        var start = choices[i].indexOf(innerPrototype) + innerPrototype.length;
        var end = choices[i].lastIndexOf("]")+1;
        if (start < end) {
          results = choices[i].substr(start, end-start);
          results = JSON.parse(results);
          callback(results);
        }
      }
    }
  }

  function ipfsPeerCat(path) {
    logger('ipfsPeerCat');
    return new Promise((resolve) => {
      ipfs.cat(path, (err, res) => {
        if (err) {
          logger('error: ipfsPeerCat failed => ');
          console.log(err);
        }
        else {
          var chunks = [];
          res.on('data', function(chunk) {
            chunks.push(chunk);
          });
          res.on('end', function() {
            var results = chunks.join('');
            ipfsCatParser(results, 'messages', function (res) {
              resolve(res);
            });
          });
        }
      });
    });
  }

  function merger(arrays) {
    var new_arr = [];
    arrays.forEach((array) => {
      new_arr = new_arr.concat(array);
    });
    sorted_arr = _.sortBy(new_arr, (o) => {
      return o.timestamp;
    });
    return _.uniq(sorted_arr, (item, key, timestamp) => {
      return item.timestamp;
    });
  }

  function getMessagesFromPeers(peers) {
    return new Promise((resolve) => {
      var peersPromises = peers.map((peer) => {
        return ipfsPeerResolve(peer).then(ipfsPeerCat);
      })
      Promise.all(peersPromises).then((messages) => {
        var mergedMessages = merger(messages);
        console.log(mergedMessages);
        resolve(mergedMessages)
      })
    })
  }

  function saveMessages(messages) {
    return new Promise((resolve) => {
      fs.writeFile('storage/messages', JSON.stringify(messages, null, 2), (err) => {
        if (err) logger('error: saveMessages failed');
        else resolve();
      })
    })
  }

  function printMessages(messages) {
    return new Promise((resolve) => {
      messages.forEach((message) => {
        var username = message.user ? message.user : 'System';
        console.log(message.timestamp + ' ' + username + ': ' + message.text);
      })
      resolve();
    })
  }

  function read(options) {
    return new Promise((resolve) => {
      fs.readFile('storage/messages', function (err, data) {
        if (err && err.code === 'ENOENT') {
          fs.writeFile('storage/messages', JSON.stringify([], null, 2), (err) => {
            if (err) logger('error: read failed');
            else resolve([]);
          });
        }
        else if (err) {
          logger('error: read failed');
        }
        else {
          resolve(JSON.parse(data));
        }
      });
    })
  }

  function write(peer_id, text) {
    return new Promise((resolve) => {
      read().then((messages) => {
        messages.push({
          user: peer_id,
          timestamp: new Date(),
          text: text
        })
        fs.writeFile('storage/messages', JSON.stringify(messages, null, 2), (err) => {
          if (err) logger('error: write failed');
          else resolve(messages);
        })
      })
    })
  }


  function addStorage() {
    logger('addStorage');
    return new Promise((resolve) => {
      ipfs.add('storage', { recursive: true }, (err, res) => {
        if (err) {
          logger('error: addStorage failed');
        }
        var hash = res.pop().Hash;
        logger('addStorage: ' + hash);
        resolve(hash);
      });
    });
  }

  function publish(hash) {
    logger('publish');
    return new Promise((resolve) => {
      ipfs.name.publish(hash, (err, res) => {
        if (err) {
          logger('error: publish failed');
        }
        var name = res.Name;
        logger('publish: ' + name);
        resolve(name);
      });
    });
  }

  function ipfsRead() {
    return new Promise((resolve) => {
      ipfsPeerID()
      .then(ipfsPeerDiscovery)
      .then(getMessagesFromPeers)
      .then(saveMessages)
      .then(read)
      .then(printMessages);
    });
  }

  function ipfsWrite(message) {
    return new Promise((resolve) => {
      ipfs.id((err, res) => {
        if (err) {
          logger('error: ipfsWrite failed');
        }
        var id = res.ID;
        write(id, message)
        .then(addStorage)
        .then(publish)
        .then((path) => {
          resolve(path);
        });
      });
    });
  }

  ipfsRead();

  //-------//

  // function ipfsWriteChain(message) {
  //   return new Promise((resolve) => {
  //     ipfs.id((err, res) => {
  //       if (err) {
  //         logger('error: ipfsWrite failed');
  //       }
  //       var id = res.ID;
  //       write(id, message)
  //       .then(addStorage)
  //       .then(publish)
  //       .then((path) => {
  //         resolve(path);
  //       });
  //     });
  //   });
  // }

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

  function storeTransaction(tx) {
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

  // function broadcastChain(chain) {
  //   for (var i = 0; i < peers.length; i++) {
  //     var peer = peers[i];
  //     console.log('Broadcasting chain to peer: ' + peer);
  //     // Todo: peer.broadcastChain(chain);
  //   }
  // }

  function processChain(newChain) {
    if (validChain(newChain) && luckier(newChain, chain)) {
      console.log('Storing new chain: ' + JSON.stringify(newChain));
      chain = newChain;
      // broadcastChain(chain);
      return true;
    }
    else {
      return false;
    }
  }

  function commit(newTransactions, newChain) {
    var timestamp = currentTimestamp();
    var previousBlock = newChain[newChain.length - 1];
    var previous = blockHash(previousBlock);
    var nonce = blockHash(newBlock(previous, newTransactions, timestamp));
    var proof = proofOfLuck(nonce);
    var newBlock = newBlock(previous, newTransactions, timestamp, proof);
    newChain.push(newBlock);
    return newChain;
  }

  function interval() {
    if (transactions === null || transactions === undefined) transactions = [];
    if (transactions.length > 0) {
      var newTransactions = transactions;
      var newChain = commit(newTransactions, chain);
      transactions = [];
      processChain(newChain);
    }
  }

  var job = new cron('*/' + ROUND_TIME + ' * * * * *', function() {
    console.log('interval(ROUND_TIME)');
    interval();
  }, null, true);
  
  app.post('/tx', function(req, res, next) {
    var tx = req.body.tx;
    if (!validTransaction(tx)) {
      invalidError(res);
    }
    else if (!isInArray(tx, transactions)) {
      storeTransaction(tx);
      var jsonDate = (new Date()).toJSON();
      var response = { message: 'success', datetime: jsonDate };
      res.status(200).json(response);
    }
    else {
      invalidTransaction(res);
    }
  });

  // app.post('/chain', function(req, res, next) {
  //   var newChain = req.body.chain;
  //   if (newChain === null || newChain === undefined) {
  //     invalidError(res);
  //   }
  //   if (processChain(newChain)) {
  //     var jsonDate = (new Date()).toJSON();
  //     var response = { message: 'success', datetime: jsonDate };
  //     res.status(200).json(response);
  //   }
  //   else {
  //     invalidChain(res);
  //   }
  // });

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

  app.get('/chain', function (req, res, next) {
    var blocks = [];
    for (var i = 0; i < 5; i++) {
      blocks.push({ transactions: [] });
    }
    var response = { blocks: blocks };
    res.status(200).json(response);
  });

  app.get('/', function (req, res, next) {
    res.render('template');
  });

  var server = app.listen(8000, function() {
    console.log('Listening on port %d', server.address().port);
  });
};

module.exports = coreApp;
