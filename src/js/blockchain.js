var async = require("async")
var cron = require("cron").CronJob
var equal = require("deep-equal")
var fs = require("fs")
var libp2pIPFS = require('libp2p-ipfs')
var multiaddr = require('multiaddr')
var ngrok = require('ngrok')
var oboe = require("oboe")
var PeerId = require('peer-id')
var PeerInfo = require('peer-info')
var pubngrok = require('pubngrok')
var request = require('request')
var series = require('run-series')
var _ = require("underscore")

var ipfs = require("ipfs-api")
ipfs = new ipfs("localhost", "5001")

var PSG = require('./pubsub')

var blockchain = function (node) {

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
  var ROUND_TIME = 10 /* Time in seconds */
  var PUBSUB_NUM_PEERS = 5 /* PubSub number of peers to connect to */
  var CLIENT_PORT = 8000

  /* Storage */
  var DIRECTORY = "storage"
  var ID_DIRECTORY = DIRECTORY + "/id"
  var PUBSUB_DIRECTORY = DIRECTORY + "/pubsub.json"
  var PUBGROK_DIRECTORY = DIRECTORY + "/pubgrok"
  var BLOCK_DIRECTORY = DIRECTORY + "/block"
  var TRANSACTIONS_DIRECTORY = DIRECTORY + "/transactions"

  /* Blockchain */
  var CRON_ON = false /* System state */
  var roundUpdate = false
  var block = {}
  var blockHash = ""
  var transactions = {}
  var chain = []

  /* PubSub */
  var PUBSUB_LOCAL = false
  var seenBlockHashes = []
  var pubSubID = {}
  var IPFS_ID = ""
  var p2pnode
  var pubSub
  var Peer

  /* TEE */
  var teeInternalCounter = 1
  var counter = teeIncrementMonotonicCounter()
  var roundBlock = null
  var roundBlockParent = null
  var roundTime = null

  initializeLocalState()

/***************************** HELPER FUNCTIONS ******************************/

  /* Initializes state of IPFS_ID, peers, block, transactions, and chain */
  function initializeLocalState() {
    ipfs.id().then((id) => {
      /* IPFS daemon id */
      IPFS_ID = id.ID
      console.log("IPFS_ID: " + IPFS_ID)

      initializePubSub().then(() => {
        /* Discover IPFS peers */
        ipfsPeerDiscover()

        /* Load local uncommitted transactions state */
        fs.readFile(TRANSACTIONS_DIRECTORY, function (err, res) {
          console.log("Initializing local transactions state...")

          if (err || !validObject(res.toString())) {
            transactions = {
              Data: "",
              Links: []
            }

            fs.writeFile(TRANSACTIONS_DIRECTORY, JSON.stringify(transactions), null)
          } else {
            transactions = JSON.parse(res.toString())
          }

          /* Load local block (chain head) state */
          fs.readFile(BLOCK_DIRECTORY, function (err, res) {
            console.log("Initializing local block state...")

            if (err || !validObject(res.toString())) {
              var data = JSON.stringify({
                luck: -1,
                attestation: "GENESIS"
              })

              var newBlock = {
                Data: data,
                Links: [{
                  name: "payload",
                  hash: "GENESIS"
                }]
              }

              ipfsWriteBlock(newBlock).then((newBlockHash) => {
                fs.writeFile(BLOCK_DIRECTORY, newBlockHash, null)

                block = newBlock
                blockHash = newBlockHash
                chain = []

                chain.push({
                  luck: -1,
                  attestation: 'GENESIS',
                  hash: blockHash,
                  payload: 'GENESIS',
                  parent: 'GENESIS',
                  transactions: []
                })

                teeProofOfLuckRound(block, chain)
              })
            } else {
              blockHash = res.toString()
              ipfsGetBlock(blockHash).then((newBlock) => {
                block = parseIPFSObject(newBlock)
                ipfsConstructChain(blockHash).then((newChain) => {
                  chain = newChain
                  teeProofOfLuckRound(block, chain)
                })
              })
            }
          })
        })
      })
    }).catch((err) => {
      console.log("initializeLocalState error: check that ipfs daemon is running")
      console.log(err)
    })
  }

  function initializePubSub() {
    logger("initializePubSub")
    return new Promise((resolve) => {
      if (PUBSUB_LOCAL) {
        /* Load Pubsub */
        fs.readFile(PUBSUB_DIRECTORY, function (err, res) {
          console.log("Initializing local PubSub state...")
        
          var ps
          if (err || !validObject(res.toString())) {
            ps = PeerId.create({ bits: 2048 }).toJSON()
            var id = PeerId.createFromJSON(ps)
            fs.writeFile(PUBSUB_DIRECTORY, JSON.stringify(ps, null, 2), null)
          }
          else {
            ps = JSON.parse(res.toString())
            var id = PeerId.createFromJSON({
              id: ps.id,
              privKey: ps.privKey,
              pubKey: ps.pubKey
            })
          }

          var peer = new PeerInfo(id)
          peer.multiaddr.add(multiaddr('/ip4/0.0.0.0/tcp/10333'))

          p2pnode = new libp2pIPFS.Node(peer)
          p2pnode.start((err) => {
            if (err) throw err

            ps.addrs = []
            console.log('Publisher listening on:')
            peer.multiaddrs.forEach((ma) => {
              console.log(ma.toString() + '/ipfs/' + id.toB58String())
              ps.addrs.push(ma.toString() + '/ipfs/' + id.toB58String())
            })

            fs.writeFile(PUBSUB_DIRECTORY, JSON.stringify(ps, null, 2), null)

            ipfsPeerPublish().then((path) => {
              console.log("Successful initialization, starting...")
              CRON_ON = true
            })

            pubSub = new PSG(p2pnode)
            pubSub.subscribe('block')
            pubSub.subscribe('transaction')

            pubSub.on('block', (newBlockHash) => {
              if (newBlockHash.toString() !== blockHash) {
                pubSubBlock(newBlockHash, false)
              }
            })

            pubSub.on('transaction', (link) => {
              pubSubTransaction(link)
            })

            resolve()
          })
        })
      }
      else {
        ngrok.connect(CLIENT_PORT, function (err, address) {
          if (err) {
            console.log(err)
          }
          else {
            console.log('Publisher listening on:', address)

            fs.writeFile(PUBGROK_DIRECTORY, address, null)

            pubSub = new pubngrok(node, address)
            pubSub.subscribe('block')
            pubSub.subscribe('transaction')

            pubSub.on('block', (newBlockHash) => {
              if (newBlockHash !== blockHash) {
                console.log("@@@@@@@@@@@@@@@@@ RECEIVED NEW BLOCK FROM PEER " + newBlockHash.toString() + " @@@@@@@@@@@@@@@@@@@@@")
                pubSubBlock(new Buffer(newBlockHash), false)
              }
            })
            pubSub.on('transaction', (link) => {
              console.log("@@@@@@@@@@@@@@@@@ RECEIVED NEW TRANSACTION FROM PEER " + newBlockHash.toString() + " @@@@@@@@@@@@@@@@@@@@@")
              pubSubTransaction(new Buffer(link))
            })

            ipfsPeerPublish().then((path) => {
              console.log("Successful initialization, starting...")
              CRON_ON = true
            })

            resolve()
          }
        })
      }
    })
  }

  var LOG_DATA = "----------------------------------------------------------------------"

  /* Prints the current peers every ROUND_TIME interval by the caller. */ 
  function printInterval() {
    console.log("[----- ROUND TIME: " + ROUND_TIME + " SECONDS -----]")
    console.log("Current list of peers: ")
    if (PUBSUB_LOCAL) console.log(Object.keys(pubSub.getPeerSet()))
    else console.log(JSON.stringify(pubSub.getPeers()))
  }

  /* Prints debug relevant messages. */
  function logger(message, error) {
    if (process.env.DEBUG) {
      console.log("# " + message)
      if (error !== null && error !== undefined && error !== "") {
        console.log(error)
      }
    }
  }

  /* Prints message for internal testing only. */
  function dlog(message) {
    console.log(message)
  }

  /* Returns the current timestamp. */
  function currentTimestamp() {
    return (new Date).getTime()
  }

  /* Parses the given data, converting any strings to JSON objects. */
  function parseIPFSObject(data) {
    if (typeof data === "string") data = JSON.parse(data)
    if (typeof data.Data === "string") data.Data = JSON.parse(data.Data)
    if (typeof data.Link === "string") data.Link = JSON.parse(data.Link)
    return data
  }

  /* Returns true if obj is contained in array, otherwise false. */
  function containsObject(obj, array) {
    for (var i = 0; i < array.length; i++) {
      if (equal(obj, array[i])) return true
      else if (i === array.length - 1) return false
    }
  }

/********************************** PEERS ************************************/

/**
 * This function adds the directory and uses the hash of this
 * application id to discover peers who are a part of this blockchain
 * application and invokes a method to attempt a connection.
 */
  function ipfsPeerDiscover() {
    logger("ipfsPeerDiscover")

    ipfs.add(ID_DIRECTORY, (err, res) => {
      if (err) {
        logger("error: ipfsPeerDiscover failed", err)
      } else {
        var hash = res[0].Hash
        oboe("http://127.0.0.1:5001/api/v0/dht/findprovs\?arg\=" + hash).done((res) => {
          if (res.Type === 4) {
            var id = res.Responses[0].ID

            if (id !== IPFS_ID) {
              logger("ipfsPeerDiscover: " + id)

              if (PUBSUB_LOCAL) {
                ipfsPubSub(id)
              } else {
                ipfsPubGrok(id)
              }
            }
          }
        }).fail(function() {
          console.log("error: ipfsPeerDiscover failed to find peers")
        })
      }
    })
  }

  function ipfsPubSub(peerID) {
    logger("ipfsPubSub")
    ipfsPeerResolve(peerID).then((path) => {
      return ipfsGetData(path, "/pubsub.json")
    }).then((p2pID) => {
      console.log("Dialing " + p2pID.id)
      var id = PeerId.createFromJSON({
        id: p2pID.id,
        privKey: p2pID.privKey,
        pubKey: p2pID.pubKey
      })

      var peer = new PeerInfo(id)

      p2pID.addrs.forEach((addr) => {
        peer.multiaddr.add(multiaddr(addr))
      })

      pubSub.connect(peer)
    })
  }

  function ipfsPubGrok(peerID) {
    logger("ipfsPubGrok")
    ipfsPeerResolve(peerID).then((path) => {
      return ipfsGetData(path, "/pubgrok")
    }).then((peerAddress) => {
      console.log("Dialing " + peerAddress)

      var peerInfo = {
        address: peerAddress,
        topics: []
      }

      pubSub.connect(peerInfo)
    })
  }

/**
 * This function takes a peer id as provided by IPFS to perform
 * an IPNS name resolution and acquire the path address to the data
 * publish by the specified peer.
 */
  function ipfsPeerResolve(id) {
    logger("ipfsPeerResolve")
    return new Promise((resolve) => {
      ipfs.name.resolve(id, null, (err, nameRes) => {
        if (err) {
          logger("ipfsPeerResolve error: " + id, err)
        } else {
          resolve(nameRes.Path)
        }
      })
    })
  }

/**
 * This function is used to fetch data from the specified path and link
 * generally acquired from the IPNS system. The data is requested and
 * upon transmission completion, is combined and parsed into usable data.
 */
  function ipfsGetData(path, link) {
    logger("ipfsGetData")
    return new Promise((resolve) => {
      ipfs.cat(path + link, (err, catRes) => {
        if (err) {
          logger("ipfsGetData error: ipfs.cat failed", err)
        } else {
          var chunks = []

          catRes.on("data", (chunk) => {
            chunks.push(chunk)
          })

          catRes.on("end", () => {
            if (chunks.length > 0) {
              var data = chunks.join("")

              if (validObject(data)) {
                if (link === "/pubgrok") {
                  resolve(data)
                } else {
                  if (typeof data === "string") data = JSON.parse(data)
                  resolve(data)
                }
              }
            }
          })
        }
      })
    })
  }

/**
 * This function adds all files in DIRECTORY to IPFS and publishes the multihash
 * reference of DIRECTORY using IPNS in order for peers to get files and necessary
 * application addresses, such as for subscribing in PubSub.
 */
  function ipfsPeerPublish() {
    logger("ipfsPeerPublish")
    return new Promise((resolve) => {
      ipfs.add(DIRECTORY, { recursive: true }, (err, addRes) => {
        if (err) logger("error: ipfsPeerPublish failed", err)
        else {
          var hash = addRes.filter((path) => {
            return path.Name === DIRECTORY
          })[0].Hash

          ipfs.name.publish(hash, null, (err, publishRes) => {
            if (err) {
              logger("ipfsPeerPublish error: ipfs.name.publish failed", err)
            } else {
              var name = publishRes.Name
              logger("ipfsPeerPublish successful: " + name)
              resolve(name)
            }
          })
        }
      })
    })
  }

/*********************************** IPFS ************************************/

  /* Returns the payload given the hash */
  function ipfsGetPayload(hash) {
    return new Promise((resolve) => {
      ipfs.object.data(hash, { enc: "base58" }, (err, data) => {
        if (err) {
          logger("ipfsGetPayload error: ", err)
        } else {
          data = data.toString()
          if (validObject(data)) {
            if (typeof data === "string") data = JSON.parse(data)
            if (typeof data.Links === "string") data.Links = JSON.parse(data.Links)
            resolve(data)
          }
        } 
      })
    })
  }

  /* Returns the block given the hash */
  function ipfsGetBlock(hash) {
    return new Promise((resolve) => {
      ipfs.object.data(hash, { enc: "base58" }, (err, data) => {
        if (err) {
          logger("ipfsGetPayload error: ", err)
        } else {
          data = data.toString()
          if (validBlock(data)) {
            data = parseIPFSObject(data)
            resolve(data)
          }
        }
      })
    })
  }

  /* Returns the transaction given the hash */
  function ipfsGetTransaction(hash) {
    return new Promise((resolve) => {
      ipfs.object.data(hash, { enc: "base58" }, (err, data) => {
        if (err) {
          logger("ipfsGetPayload error: ", err)
        } else {
          data = data.toString()
          if (validTransactionPayload(data)) {
            if (typeof data === "string") {
              data = JSON.parse(data)
            }
            resolve(data)
          }
        }
      })
    })
  }

  /* Returns a hash to the given newPayload */
  function ipfsWritePayload(newPayload) {
    return new Promise((resolve) => {
      ipfs.object.put(new Buffer(JSON.stringify(newPayload)), (err, res) => {
        if (err) {
          logger("error: ipfsWritePayload failed", err)
        } else {
          resolve(res.toJSON().Hash)
        }
      })
    })
  }

  /* Returns a hash to the given newBlock */
  function ipfsWriteBlock(newBlock) {
    return new Promise((resolve) => {
      ipfs.object.put(new Buffer(JSON.stringify(newBlock)), (err, res) => {
        if (err) {
          logger("error: ipfsWriteBlock failed", err)
        } else {
          resolve(res.toJSON().Hash)
        }
      })
    })
  }

  /* Returns a chain array of custom blocks given the head blockHash of a chain */
  function ipfsConstructChain(headBlockHash) {
    logger("ipfsConstructChain")
    return new Promise((resolve) => {
      var newChain = []
      var chained = true
      var nextBlockHash = headBlockHash

      async.whilst(
        function() { 
          return chained 
        },
        function(callback) {
          ipfsGetBlock(nextBlockHash).then((newBlock) => {
            nextBlock = parseIPFSObject(newBlock)
            
            var internalBlock = {
              luck: nextBlock.Data.luck,
              attestation: nextBlock.Data.attestation,
              hash: nextBlockHash,
              payload: nextBlock.Links[0].hash,
              parent: "",
              transactions: []
            }

            if (internalBlock.payload === "GENESIS") {
              internalBlock.parent = "GENESIS"
              chained = false
              newChain.unshift(internalBlock)
              callback(null, newChain)
            } else {
              ipfsGetPayload(internalBlock.payload).then((payload) => {
                for (var i = 0; i < payload.Links.length; i++) {
                  var elem = payload.Links[i]

                  if (elem.name === "parent") {
                    internalBlock.parent = elem.hash
                  } else if (elem.name === "transaction" && validTransactionLink(elem)) {
                    internalBlock.transactions.push(elem)
                  }

                  if (i === payload.Links.length - 1) {
                    newChain.unshift(internalBlock)
                    nextBlockHash = internalBlock.parent
                    callback(null, newChain)
                  }
                }
              })
            }
          })
        },
        function (err, newChain) {
          err ? logger(err) : resolve(newChain)
        }
      )
    })
  }

/********************************** LOCAL ************************************/

  /* Writes the given newBlockHash to local storage */
  function localWriteBlockHash(newBlockHash) {
    return new Promise((resolve) => {
      fs.writeFile(BLOCK_DIRECTORY, newBlockHash, (err) => {
        if (err) {
          logger("error: localWriteBlockHash failed", err)
        } else {
          resolve()
        }
      })
    })
  }

  /* Writes the given newTransactionLink to local storage */
  function localWriteTransactionLink(newTransactionLink) {
    return new Promise((resolve) => {
      if (!containsObject(newTransactionLink, transactions.Links)) {
        transactions.Links.push(newTransactionLink)
        fs.writeFile(TRANSACTIONS_DIRECTORY, JSON.stringify(transactions, null, 2), (err) => {
          if (err) {
            logger("error: localWriteTransactionLink failed", err)
          } else {
            resolve()
          }
        })
      }
    })
  }

  /* Writes the uncommited transactions to local storage */
  function localWriteTransactions() {
    fs.writeFile(TRANSACTIONS_DIRECTORY, JSON.stringify(transactions, null, 2), (err) => {
      if (err) {
        logger("error: localWriteTransactions failed", err)
      } else {
        logger("localWriteTransactions success")
      }
    })
  }

/*********************************** TEE *************************************/

  /* Returns a secure quote from TEE */
  function teeQuote(report) {
    return { report: report, luck: report.luck }
  }

  /* Returns a secure report from TEE */
  function teeReport(nonce, luck) {
    return { nonce: nonce, luck: luck }
  }

  /* Returns secure report data from TEE */
  function teeReportData(data) {
    if (validObject(data)) {
      if (data === "GENESIS") return { nonce: "GENESIS", luck: -1 }
      else if (typeof data === "string") data = JSON.parse(data)
      else return data
    }
  }

  /* Returns true if TEE proof is valid */
  function teeValidAttestation(attestation) {
    if (!validObject(attestation)) return false
    return true
  }

  /* Returns the trusted system time from TEE */
  function teeGetTrustedTime() {
    return currentTimestamp()
  }

  /* Returns a random value on request from TEE */
  function teeGetRandom() {
    var rand = Math.random()
    while (rand === 0) rand = Math.random()
    return 1 / rand
  }

  /* Returns the internal counter value from TEE */
  function teeReadMonotonicCounter() {
    return teeInternalCounter
  }

  /* Returns the monotonically incremented internal counter value from TEE */
  function teeIncrementMonotonicCounter() {
    teeInternalCounter++
    return teeInternalCounter
  }

/********************************** CHAIN ************************************/

  /* Returns true if obj is defined and has content */
  function validObject(obj) {
    if (obj === null || obj === undefined || obj === "") return false
    else return true
  }

  /* Returns true if the array of transaction links contains our defined structure */
  function validTransactionPayload(txp) {
    if (!validObject(txp)) return false
    else {
      if (typeof txp === "string") txp = JSON.parse(txp)
      return validObject(txp.Data)
    }
  }

  /* Returns true if tx contains our defined structure of a transaction link
   * AND is not in our list of uncommitted transactions or a spent transaction */
  function validTransactionLink(tx) {
    if (tx === null || tx === undefined) return false
    else if (tx.name !== 'transaction') return false
    else if (!validObject(tx.hash) || tx.hash === "GENESIS") return false
    else {
      if (typeof tx === "string") tx = JSON.parse(tx)

      /* Returns false if tx is contained in current chain or transactions */
      if (containsObject(tx, transactions.Links)) return false
      else for (var i = 0; i < chain.length; i++) {
        if (containsObject(tx, chain[i].transactions)) return false
        else if (i === chain.length - 1) return true
      }
    }
  }

  /* Returns true if the array of transaction links contains our defined structure */
  function validTransactions(txs) {
    if (txs === null || txs === undefined) return false
    else {
      if (typeof txs === "string") txs = JSON.parse(txs)

      if (txs.length === 0) return true
      for (var i = 0; i < txs.length; i++) {
        if (!validTransactionLink(txs[i])) return false
        else if (i === txs.length - 1) return true
      }
    }
  }

  /* Returns true if block b contains our defined structure of a block */
  function validBlock(b) {
    if (!validObject(b)) return false
    else if (typeof b !== "object" && typeof b !== "string") return false
    else {
      b = parseIPFSObject(b)
      if (!validObject(b.Data)) return false
      else if (!validObject(b.Data.luck)) return false
      else if (!validObject(b.Data.attestation)) return false
      else if (!validObject(b.Links) || b.Links.length !== 1) return false
      else if (b.Links[0].name !== "payload") return false
      else if (!validObject(b.Links[0].hash)) return false
      else if (b.Links[0].hash !== "GENESIS" && b.Data.luck < 1) return false
      else return true
    }
  }

  /* Returns true if payload p contains our defined structure of a payload */
  function validPayload(p) {
    if (!validObject(p)) return false
    else if (typeof p !== "object" && typeof p !== "string") return false
    else {
      if (typeof p === "string") p = JSON.parse(p)
      if (typeof p.Links === "string") p.Links = JSON.parse(p.Links)

      if (!validObject(p.Links)) return false
      else if (p.Links.length < 2) return false
      else {
        var containsParent = false
        for (var i = 0; i < p.Links.length; i++) {
          if (p.Links[i].name === "parent") containsParent = true
          if (i === p.Links.length - 1) return containsParent
        }
      }
    }
  }

/********************************* ALGORITHM 4 *******************************/

/**
 * This function is a TEE method that sets the state of roundBlock
 * and roundTime. The trusted time service teeGetTrustedTime() represents
 * a standard method provided as part of the TEE and is used as 
 * verification for ROUND_TIME when mining a new block.
 */
  function teeProofOfLuckRound(thisBlock, thisChain) {
    roundBlock = thisBlock
    roundBlockParent = thisChain[0].parent
    roundTime = teeGetTrustedTime()
  }

/**
 * This function is a TEE method that uses the given blockhash and
 * starts by checking the required ROUND_TIME has elapsed before
 * proceeding to generate a new luck value, using it to compute an
 * f(l) which determines the amount of time the TEE will sleep.
 * Upon return from sleeping f(l) duration, the function returns
 * a teeReport() that includes the luck value and nonce, which is
 * defined to be the given blockhash.
 */
  function teeProofOfLuckMine(headerParentHash, callback) {
    if (headerParentHash !== blockHash || (chain[0].parent !== roundBlockParent && chain[0].parent !== 'GENESIS')) {
      callback("teeProofOfLuckMine error: header and parent mismatch", null)
    } else {
      var now = teeGetTrustedTime()

      if (now < roundTime + ROUND_TIME) {
        callback("teeProofOfLuckMine error: time", null)
      }
      else {
        l = teeGetRandom()
        var fl = (l / Number.MAX_VALUE) * ROUND_TIME
        logger("teeSleep: " + fl + " seconds")

        setTimeout(function() {
          logger("returned from teeSleep")
          var newCounter = teeReadMonotonicCounter()
          var nonce = headerParentHash

          if (counter !== newCounter) {
            callback("teeProofOfLuckMine error: counter", null)
          } else {
            callback(null, teeReport(nonce, l))
          }
        }, fl * 1000)
      }
    } 
  }

/********************************* ALGORITHM 5 *******************************/

/**
 * This function is responsible for constructing a new block with the
 * provided uncommitted transaction links, which can be empty.
 *
 * Starting with the uncommitted transaction links, the function
 * constructs a payload object, pushing the current blockhash, which
 * represents the parent, and writes it to IPFS to get the multihash.
 * The multihash is then provided as a nonce to the TEE method
 * teeProofOfLuckMine, which returns a proof that is appended to the
 * a newly constructed block in accordance to the blockchain protocol.
 * The block is then written to IPFS and the corresponding blockhash
 * (multihash) represents the new commit, which is returned to the
 * calling function.
 */
  function commit(newTransactionLinks) {
    logger("commit")
    return new Promise((resolve) => {

      var newBlockPayload = {
        Data: "",
        Links: newTransactionLinks.slice()
      }

      newBlockPayload.Links.push({
        name: "parent",
        hash: blockHash
      })

      ipfsWritePayload(newBlockPayload).then((hash) => {

        teeProofOfLuckMine(blockHash, (err, proof) => {
          if (err) {
            logger(err)
          } else {
            var newBlock = {
              Data : {
                luck: proof.luck,
                attestation: proof
              },
              Links: [{
                name: "payload",
                hash: hash
              }]
            }

            ipfsWriteBlock(newBlock).then((newBlockHash) => {
              console.log("New Commit: " + newBlockHash)

              transactions.Links = []
              localWriteTransactions()
              resolve(newBlockHash)
            })
          }
        })
      }).catch((err) => {
        logger("Commit failed", err)
      })
    })
  }

/********************************* ALGORITHM 6 *******************************/

/**
 * This function computes the total luck value of the given chain by
 * iterating through each block and invoking the TEE method teeReportData()
 * to get the trusted luck value and summing to a running total. After
 * all blocks are visited, the function returns the total luck value
 * of the given blockchain.
 */
  function luck(thisChain) {
    var totalLuck = 0
    for (var i = 0; i < thisChain.length; i++) {

      var report = teeReportData(thisChain[i].attestation)

      if (thisChain[i].payload !== "GENESIS" && report.luck >= 1) {
        totalLuck += report.luck
      }

      if (i === thisChain.length - 1) {
        return totalLuck
      }
    }
  }

/********************************* ALGORITHM 7 *******************************/

/**
 * This function verifies the validity the given chain by confirming
 * it is a object with correct parameters (parent, attestation, payload,
 * length) and verifying that the blockchain data includes a valid 
 * attestation by generating a report from the TEE. If every block
 * in the provided chain follows our defined structure, then and only then
 * does the method return true; otherwise, it returns false.
 */
  function validChain(newChain) {
    if (!validObject(newChain)) {
      return false
    }
    else {
      if (typeof newChain === "string") {
        newChain = JSON.parse(newChain)
      }

      var previousBlockHash = "GENESIS"
      var testChain = newChain.slice()

      for (var i = 0; i < testChain.length; i++) {
        var testBlock = testChain[i]
        var report = teeReportData(testBlock.attestation)

        if (!validObject(testBlock)) {
          return false
        } else if (testBlock.parent !== previousBlockHash) {
          return false
        } else if (!teeValidAttestation(testBlock.attestation)) {
          return false
        } else if (testBlock.payload !== "GENESIS" && report.nonce !== testBlock.parent) {
          return false
        } else if (i === testChain.length - 1) {
          return true
        }
        
        previousBlockHash = testBlock.hash
      }
    }
  }

/********************************* ALGORITHM 8 *******************************/

/**
 * This function invokes teeProofOfLuckRound() in Algorithm 4 which
 * sets state on our roundBlock and roundTime, then invokes our 
 * resetCallback() function to construct a new commit and publish
 * the candidate block to peers.
 */
  function newRound(newBlock, newChain, selfInvocation) {
    logger("newRound")
    teeProofOfLuckRound(newBlock, newChain)
    resetCallback(selfInvocation)
  }

/**
 * This function handles all PubSub requests that are blocks by
 * parsing the blockhash, a Buffer, and verifying the reconstructed
 * block referenced by the blockhash is of valid format as defined by
 * the blockchain protocol. It will then proceed to reconstruct the
 * entire blockchain referenced by the provided block head and
 * determine if this chain is luckier than our application's existing
 * chain.
 *
 * If the new chain is determined to be luckier, it will write the
 * new blockhash to local state and to local storage, then proceed
 * to filter any overlapping transactions between the new blockchain
 * and list of uncommited transactions.
 *
 * Only after all of these procedures succeeds will the protocol
 * proceed to:
 *   1. Publish the valid and winning blockhash to connected peers.
 *   2. Proceed to start a newRound() of mining with the newBlock
 *      and newChain reference, if the roundBlock is not defined or
 *      if the parent hash of the new blockchain does not match the
 *      roundBlock's parent hash.
 *
 * Lastly, roundUpdate is set to true if the pubSubBlock()
 * invocation came from a peer. In this case, as the block head
 * update was successful, we will not invoke the resetCallback()
 * method for this interval, as part of the blockchain protocol.
 */
  function pubSubBlock(newBlockHash, selfInvocation) {
    logger("pubSubBlock - " + newBlockHash.toString())

    newBlockHash = newBlockHash.toString()
    ipfsGetBlock(newBlockHash).then((newBlock) => {

      /* Skip previously considered block references */
      if (!containsObject(newBlockHash, seenBlockHashes) && !equal(newBlock, block)) {

        ipfsConstructChain(newBlockHash).then((newChain) => {
          logger("pubSub: constructed chain from newBlockHash")

          seenBlockHashes.push(newBlockHash)

          /* Check if newChain is valid and luckier than our current chain */
          if (validChain(newChain) && luck(newChain) > luck(chain)) {
            logger("pubSub: found luckier block")

            ipfsWriteBlock(newBlock).then((newBlockHash) => {
              console.log("PubSub: Luckier block accepted, writing block...")

              localWriteBlockHash(newBlockHash).then(() => {
                /* Update uncommitted transactions for new chain */
                for (var i = 0; i < newChain.length; i++) {

                  var txs = newChain[i].transactions

                  transactions.Links = _.reject(transactions.Links, function(obj) {
                    return _.find(txs, { luck: obj.luck })
                  })

                  if (i === newChain.length - 1) {
                    console.log("PubSub: Block update successful")

                    /* Update local uncomitted transaction state */
                    localWriteTransactions()

                    /* Update local blockchain state with new block */
                    chain = newChain
                    block = newBlock
                    blockHash = newBlockHash

                    /* Set the update for this interval to true */
                    if (!selfInvocation) {
                      roundUpdate = true
                    }

                    /* Publish it to peers */
                    if (PUBSUB_LOCAL) {
                      pubSub.publish('block', new Buffer(newBlockHash))
                    } else {
                      pubSub.publish('block', newBlockHash)
                    }

                    /* Start a new round of mining */
                    if (roundBlock === null || roundBlock === undefined) {
                      newRound(newBlock, newChain, selfInvocation)
                    } else if (newChain[0].parent != roundBlockParent) {
                      newRound(newBlock, newChain, selfInvocation)
                    }
                  }
                }
              })
            })
          }
        })
      }
    })
  }
  
/**
 * This function handles all PubSub requests that are transactions
 * by parsing the transaction link, a Buffer, verifying it is of valid
 * format as defined by our blockchain protocol, and proceeds to:
 *   1. Publish the valid transaction link to connect peers.
 *   2. Write the valid transaction link to the local list of
 *      uncommitted transactions and to local storage should the
 *      client disconnect or fail.
 */
  function pubSubTransaction(link) {
    logger("pubSub: transaction - " + link.toString())

    var txLink = JSON.parse(link.toString())

    /* Verify transaction link structure is valid */
    if (validTransactionLink(txLink)) {

      ipfsGetTransaction(txLink.hash).then((txPayload) => {
        if (validTransactionPayload(txPayload)) {

          /* Publish it to peers */
          if (PUBSUB_LOCAL) {
            pubSub.publish('transaction', new Buffer(link))
          } else {
            pubSub.publish('transaction', link.toString())
          }

          /* Write it to local state */
          localWriteTransactionLink(txLink).then(() => {
            console.log("pubSub: added transaction link")
          })
        }
      })
    }
  }

/**
 * This function invokes commit() with the current list of uncommited
 * transactions, which can be empty, to construct a new commit (block).
 * The blockhash is then published as a challenger for the new block head.
 */
  function resetCallback(selfInvocation) {
    var newTransactionLinks = transactions.Links.slice()
    commit(newTransactionLinks).then((newBlockHash) => {
      pubSubBlock(new Buffer(newBlockHash), selfInvocation)
    })
  }

/**
 * Functions as the heartbeat of the blockchain, invoking round update 
 * after successful initialization, calling resetCallback() if a block
 * update has not already occured during this ROUND_TIME.
 */
  var roundInterval = new cron("*/" + ROUND_TIME + " * * * * *", function() {
    if (CRON_ON) {
      printInterval()
      // if (PUBSUB_LOCAL) {
      //   if (Object.keys(pubSub.getPeerSet()).length === 0) ipfsPeerDiscover()
      // }
      // else if (pubSub.getPeers().length === 0) ipfsPeerDiscover()

      if (!roundUpdate) {
        resetCallback(true)
      }
      roundUpdate = false
    }
  }, null, true)
  
/********************************** NETWORK **********************************/

  node.post("/tx", function(req, res, next) {
    if (req.body !== undefined || req.body !== null) {
      var tx = req.body.tx
      if (validTransactionPayload(tx)) {
        console.log("/tx request received")

        ipfsWritePayload(tx).then((hash) => {
          logger('/tx payload hash: ' + hash)

          var txLink = {
            name: "transaction",
            hash: hash
          }

          if (!validTransactionLink(txLink)) {
            res.status(400).json({
              error: "invalid"
            })
          }
          else {
            /* Publish it to peers */
            pubSub.publish('transaction', new Buffer(JSON.stringify(txLink)))
            
            /* Write it locally */
            localWriteTransactionLink(txLink).then(() => {
              console.log("/tx request successful")

              res.status(200).json({
                message: "success",
                datetime: currentTimestamp()
              })
            })
          }
        })
      }
    }
  })

  node.get("/chain", function (req, res, next) {
    res.status(200).json({
      chain: chain
    })
  })

  node.get("/peers", function (req, res, next) {
    var peerList
    if (PUBSUB_LOCAL) {
      peerList = Object.keys(pubSub.getPeerSet())
    } else {
      peerList = pubSub.getPeers()
    }

    res.status(200).json({
      peers: peerList
    })
  })

  node.get("/", function (req, res, next) {
    res.render("template")
  })

  var server = node.listen(CLIENT_PORT, function() {
    console.log("Listening on port %d", server.address().port)
  })

/*****************************************************************************/

}

module.exports = blockchain
