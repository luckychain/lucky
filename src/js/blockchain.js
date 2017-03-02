var _ = require('underscore')
var assert = require('assert')
var socketIo = require('socket.io')
var IPFS = require('ipfs-api')
var isIPFS = require('is-ipfs')
var bs58 = require('bs58')
var enclave = require('./enclave')()
var SecureWorker = require('./secureworker')
var fiberUtils = require('./fiber-utils')

var ROUND_TIME = 10 // seconds
var BLOCKCHAIN_ID = "lucky-chain-0.1"

class Node {
  constructor(blockchain, object) {
    this.blockchain = blockchain
    this.object = {
      Data: object.Data || object.data || "",
      Links: object.Links || object.links || []
    }

    this.object.Links.map((link) => {
      var result = {
        Name: link.Name || link.name || (() => {throw new Error("Link without a name")})(),
        Hash: link.Hash || link.hash || link.multihash || (() => {throw new Error("Link without a hash")})(),
        Size: _.isFinite(link.Size) ? link.Size : _.isFinite(link.Tsize) ? link.Tsize : _.isFinite(link.size) ? link.size : (() => {throw new Error("Link without a size")})()
      }

      return result
    })
  }

  getLinks(name) {
    return this.object.Links.filter((link) => {
      return link.Name === name
    })
  }
}

class Payload extends Node {
  constructor(blockchain, object) {
    super(blockchain, object)

    if (this.object.Data !== "") {
      throw new Error("Payload should not contain data, but it does: " + this.object.Data)
    }
    var parentLinks = this.getLinks("parent")
    if (parentLinks.length > 1) {
      // Genesis block has zero parent links.
      throw new Error("At most one parent link is allowed")
    }

    for (var link of this.object.Links) {
      if (link.Name !== "transaction" && link.Name !== "parent") {
        throw new Error("Invalid link: " + link.Name)
      }
    }

    this._transactionsLinks = this.getLinks("transaction")

    if (parentLinks.length) {
      this._parentLink = parentLinks[0]
    }
    else {
      // Genesis block.
      this._parentLink = null
    }
  }

  getTransactionsLinks() {
    return this._transactionsLinks
  }

  getParentLink() {
    return this._parentLink
  }

  getParent() {
    var parentLink = this.getParentLink()
    if (parentLink) {
      return this.blockchain.getBlock(parentLink.Hash)
    }
    else {
      // Genesis block.
      return null
    }
  }
}

class Block extends Node {
  constructor(blockchain, object) {
    super(blockchain, object)

    if (this.object.Links.length !== 1 || this.object.Links[0].Name !== "payload") {
      throw new Error("Exactly one link, payload, is required")
    }

    this.data = JSON.parse(this.object.Data)

    if (!_.isFinite(this.data.Luck) || this.data.Luck < 0.0 || this.data.Luck >= 1.0) {
      throw new Error("Invalid luck: " + this.data.Luck)
    }
    if (!_.isObject(this.data.Proof) || !this.data.Proof.Attestation || !this.data.Proof.Quote) {
      throw new Error("Invalid proof")
    }

    this.data.Proof.Attestation = new Uint8Array(bs58.decode(this.data.Proof.Attestation)).buffer
    this.data.Proof.Quote = new Uint8Array(bs58.decode(this.data.Proof.Quote)).buffer

    if (!SecureWorker.validateRemoteAttestation(this.data.Proof.Quote, this.data.Proof.Attestation)) {
      throw new Error("Invalid attestation")
    }

    var nonce = enclave.teeProofOfLuckNonce(this.data.Proof.Quote)

    if (nonce.luck !== this.data.Luck) {
      throw new Error("Proof's luck does not match block's luck")
    }
    if (nonce.hash !== this.getPayloadLink().Hash) {
      throw new Error("Proof's payload does not match block's payload")
    }
  }

  getPayloadLink() {
    return this.object.Links[0]
  }

  getPayload() {
    return this.blockchain.getPayload(this.object.Links[0].Hash)
  }

  getLuck() {
    return this.data.Luck
  }

  getParentLink() {
    return this.getPayload().getParentLink()
  }

  getParent() {
    return this.getPayload().getParent()
  }
}

class Blockchain {
  constructor(node, options) {
    this.node = node
    this.options = _.defaults(options || {}, {
      clientPort: 8000,
      ipfsOptions: {
        host: "localhost",
        port: "5001",
        protocol: "http"
      },
      blockchainId: BLOCKCHAIN_ID,
      peersUpdateInterval: 15 * 1000 // ms
    })

    this._cache = new Map()

    this.ipfs = new IPFS(this.options.ipfsOptions)

    this.ipfs.idSync = fiberUtils.wrap(this.ipfs.id)
    this.ipfs.object.getSync = fiberUtils.wrap(this.ipfs.object.get)
    this.ipfs.object.putSync = fiberUtils.wrap(this.ipfs.object.put)
    this.ipfs.pin.addSync = fiberUtils.wrap(this.ipfs.pin.add)
    this.ipfs.pin.rmSync = fiberUtils.wrap(this.ipfs.pin.rm)
    this.ipfs.pubsub.pubSync = fiberUtils.wrap(this.ipfs.pubsub.pub)
    this.ipfs.pubsub.subSync = fiberUtils.wrap(this.ipfs.pubsub.sub)
    this.ipfs.pubsub.peersSync = fiberUtils.wrap(this.ipfs.pubsub.peers)

    this.peers = new Map()

    this._pendingTransactions = []
  }

  getPayload(address) {
    if (!this._cache.has(address)) {
      this._cache.set(address, new Payload(this, this._getNode(address)))
    }

    var payload = this._cache.get(address)
    assert(payload instanceof Payload)
    return payload
  }

  getBlock(address) {
    if (!this._cache.has(address)) {
      this._cache.set(address, new Block(this, this._getNode(address)))
    }

    var block = this._cache.get(address)
    assert(block instanceof Block)
    return block
  }

  _getNode(address) {
    ipfs.object.getSync(address).toJSON()
  }

  start() {
    this._getIPFSInfo()
    this._startPubSub()
    this._startWebInterface()
  }

  getPeers() {
    return Array.from(this.peers.values())
  }

  getChain() {
    // TODO: Implement.
  }

  _getIPFSInfo() {
    this.ipfsInfo = this.ipfs.idSync()
    console.log("IPFS info", this.ipfsInfo)
  }

  _startWebInterface() {
    var server = this.node.listen(this.options.clientPort, () => {
      console.log("Web interface listening", server.address())
    })
    this.socketIo = socketIo(server)

    this.socketIo.on("connection", (socket) => {
      console.log("HTTP client connected")

      socket.on('peers', fiberUtils.in(() => {
        socket.emit('peersResult', this.getPeers())
      }))

      socket.on('chain', fiberUtils.in(() => {
        socket.emit('chainResult', this.getChain())
      }))
    })

    this.node.get("/peers", fiberUtils.in((req, res, next) => {
      res.status(200).json({
        peers: this.getPeers()
      })
    }))

    this.node.get("/chain", fiberUtils.in((req, res, next) => {
      res.status(200).json({
        chain: this.getChain()
      })
    }))

    this.node.post("/tx", fiberUtils.in((req, res, next) => {
      // TODO: Validate that it is a POST request.

      if (!_.isObject(req.body) || !req.body.type || !req.body.data || !_.isString(req.body.data)) {
        res.status(400).json({error: "invalid"})
        return
      }

      var type = req.body.type
      if (type === "address") {
        this._onNewTransactionAddress(req.body.data, res)
      }
      else if (type === "data") {
        this._onNewTransactionData(req.body.data, res)
      }
      else {
        res.status(400).json({error: "invalid"})
      }
    }))

    this.node.get("*", (req, res, next) => {
      res.render("template")
    })
  }

  getTransactionsTopic() {
    return `${this.options.blockchainId}/transactions`
  }

  getBlocksTopic() {
    return `${this.options.blockchainId}/blocks`
  }

  _startPubSub() {
    var transactions = this.ipfs.pubsub.subSync(this.getTransactionsTopic(), {discover: true})
    transactions.on('data', fiberUtils.in((obj) => {
      if (obj.data) {
        this._onTransaction(bs58.encode(obj.data))
      }
    }))
    var blocks = this.ipfs.pubsub.subSync(this.getBlocksTopic(), {discover: true})
    blocks.on('data', fiberUtils.in((obj) => {
      if (obj.data) {
        this._onBlock(bs58.encode(obj.data))
      }
    }))

    setInterval(fiberUtils.in(() => {
      this._updatePeers()
    }), this.options.peersUpdateInterval)
  }

  _onTransaction(transactionAddress) {
    console.log("New pending transaction: " + transactionAddress)
  }

  _onBlock(blockAddress) {
    console.log("New possible block: " + blockAddress)
  }

  _updatePeers() {
    var transactionsPeers = this.ipfs.pubsub.peersSync(this.getTransactionsTopic())
    var blocksPeers = this.ipfs.pubsub.peersSync(this.getBlocksTopic())

    var peers = _.union(transactionsPeers, blocksPeers)

    for (var peer of peers) {
      if (!this.peers.has(peer)) {
        this.peers.set(peer, this.ipfs.idSync(peer))
      }
    }
  }

  /**
   * Is a transaction with given hash already pending for the next block?
   */
  isPendingTransaction(hash) {

  }

  /**
   * Called when we get a new transaction request over our HTTP API with
   * transaction address directly specified.
   */
  _onNewTransactionAddress(data, res) {
    if (!isIPFS.multihash(data)) {
      res.status(400).json({error: "invalid"})
      return
    }

    // We do not want duplicate transactions in the same block,
    // but we do allow duplicate transactions across blocks.
    // This is an arbitrary design decision for this implementation.
    if (this.isPendingTransaction(data)) {
      res.status(400).json({error: "pending"})
      return
    }

    try {
      this.ipfs.pubsub.pubSync(this.getTransactionsTopic(), bs58.decode(data))
      console.log("New transaction with address: " + data)
    }
    catch (error) {
      res.status(400).json({error: "error"})
      throw error
    }
    res.status(200).json({message: "success"})
  }

  /**
   * Called when we get a new transaction request over our HTTP API with
   * transaction payload specified.
   */
  _onNewTransactionData(data, res) {
    var response
    try {
      response = this.ipfs.object.putSync({
        Data: data,
        Links: []
      })
    }
    catch (error) {
      res.status(400).json({error: "error"})
      throw error
    }

    this._onNewTransactionAddress(response.Hash, res)
  }
}

module.exports = function blockchain(node, options) {
  fiberUtils.in(() => {
    new Blockchain(node, options).start()
  })()
}
