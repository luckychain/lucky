var _ = require('underscore')
var assert = require('assert')
var socketIo = require('socket.io')
var IPFS = require('ipfs-api')
var isIPFS = require('is-ipfs')
var bs58 = require('bs58')
var dagPB = require('ipld-dag-pb')
var enclave = require('./enclave')()
var SecureWorker = require('./secureworker')
var fiberUtils = require('./fiber-utils')

var DAGNodeCreateSync = fiberUtils.wrap(dagPB.DAGNode.create)

var ROUND_TIME = 10 // seconds
var BLOCKCHAIN_ID = "lucky-chain-0.1"

class Node {
  constructor(blockchain, object, address) {
    this.blockchain = blockchain
    this.object = {
      Data: object.Data || object.data || "",
      Links: object.Links || object.links || []
    }

    if (this.object.Data instanceof Buffer) {
      this.object.Data = this.object.Data.toString()
    }

    this.object.Links = this.object.Links.map((link) => {
      return {
        Name: link.Name || link.name || (() => {throw new Error("Link without a name")})(),
        Hash: link.Hash || link.hash || link.multihash || (() => {throw new Error("Link without a hash")})(),
        Size: _.isFinite(link.Size) ? link.Size : _.isFinite(link.Tsize) ? link.Tsize : _.isFinite(link.size) ? link.size : (() => {throw new Error("Link without a size")})()
      }
    })

    var dagNode = DAGNodeCreateSync(this.object.Data, this.object.Links, 'sha2-256')
    this._size = dagNode.serialized.length

    // It can be null if not specified.
    this.address = address || null

    if (this.address) {
      assert(dagNode.toJSON().multihash === this.address, `Serialized node's hash '${dagNode.toJSON().multihash}' does not match provided address '${this.address}`)
    }
  }

  getLinks(name) {
    return this.object.Links.filter((link) => {
      return link.Name === name
    })
  }

  toJSON() {
    // TODO: We should maybe return a deep copy of the object?
    return this.object
  }

  getAddress() {
    if (!this.address) throw new Error("Address not known")

    return this.address
  }

  getBlockSize() {
    return this._size
  }

  getCumulativeSize() {
    var recursiveSize = 0
    for (var link of this.object.Links) {
      recursiveSize += link.Size
    }
    return this.getBlockSize() + recursiveSize
  }
}

class Payload extends Node {
  constructor(blockchain, object, address) {
    super(blockchain, object, address)

    var parentLinks = this.getLinks("parent")
    if (parentLinks.length > 1) {
      // Genesis block has zero parent links.
      throw new Error("At most one parent link is allowed")
    }
    if (parentLinks.length === 0) {
      if (this.object.Data !== "GENESIS") {
        throw new Error(`Genesis payload should contain data 'GENESIS', but it contains: ${this.object.Data}`)
      }
    }
    else {
      if (this.object.Data !== "") {
        throw new Error(`Payload should not contain data, but it does: ${this.object.Data}`)
      }
    }

    for (var link of this.object.Links) {
      if (link.Name !== "transaction" && link.Name !== "parent") {
        throw new Error(`Invalid link: ${link.Name}`)
      }
    }

    this._transactionsLinks = this.getLinks("transaction")

    if (parentLinks.length) {
      this._parentLink = parentLinks[0].Hash
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
      return this.blockchain.getBlock(parentLink)
    }
    else {
      // Genesis block.
      return null
    }
  }
}

class Block extends Node {
  constructor(blockchain, object, address) {
    super(blockchain, object, address)

    if (this.object.Links.length !== 1 || this.object.Links[0].Name !== "payload") {
      throw new Error("Exactly one link, payload, is required")
    }

    this.data = JSON.parse(this.object.Data)

    if (!_.isFinite(this.data.Luck) || this.data.Luck < 0.0 || this.data.Luck >= 1.0) {
      throw new Error(`Invalid luck: ${this.data.Luck}`)
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
    if (nonce.hash !== this.getPayloadLink()) {
      throw new Error("Proof's payload does not match block's payload")
    }
  }

  getPayloadLink() {
    return this.object.Links[0].Hash
  }

  getPayload() {
    return this.blockchain.getPayload(this.getPayloadLink())
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
    this.ipfs.object.statSync = fiberUtils.wrap(this.ipfs.object.stat)
    this.ipfs.pin.addSync = fiberUtils.wrap(this.ipfs.pin.add)
    this.ipfs.pin.rmSync = fiberUtils.wrap(this.ipfs.pin.rm)
    this.ipfs.pubsub.pubSync = fiberUtils.wrap(this.ipfs.pubsub.pub)
    this.ipfs.pubsub.subSync = fiberUtils.wrap(this.ipfs.pubsub.sub)
    this.ipfs.pubsub.peersSync = fiberUtils.wrap(this.ipfs.pubsub.peers)

    this.peers = new Map()

    this._pendingTransactions = []
    this._roundBlock = null
    this._roundCallback = null
    // Latest block represents currently known best chain.
    // It can be different from round block if it shares the same parent.
    this._latestBlock = null
  }

  getPayload(address) {
    if (!this._cache.has(address)) {
      var node = this._getNode(address)
      var payload = new Payload(this, node, address)

      // We check again because fiber could yield in meantime.
      if (!this._cache.has(address)) {
        this._cache.set(address, payload)
      }
    }

    var payload = this._cache.get(address)
    assert(payload instanceof Payload)
    return payload
  }

  getBlock(address) {
    if (!this._cache.has(address)) {
      var node = this._getNode(address)
      var block = new Block(this, node, address)

      // We check again because fiber could yield in meantime.
      if (!this._cache.has(address)) {
        this._cache.set(address, block)
      }
    }

    var block = this._cache.get(address)
    assert(block instanceof Block)
    return block
  }

  _getNode(address) {
    return this.ipfs.object.getSync(address).toJSON()
  }

  start() {
    this._getIPFSInfo()
    this._startPubSub()
    this._startWebInterface()
    this._startMining()
  }

  getPeers() {
    return Array.from(this.peers.values())
  }

  getChain() {
    var chain = []
    var block = this._latestBlock
    while (block) {
      var json = block.toJSON()
      json.Links[0].Content = block.getPayload().toJSON()
      chain.push(json)
      block = block.getParent()
    }
    return chain
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
        this._onTransaction(obj.data.toString('utf8'))
      }
    }))
    var blocks = this.ipfs.pubsub.subSync(this.getBlocksTopic(), {discover: true})
    blocks.on('data', fiberUtils.in((obj) => {
      if (obj.data) {
        this._onBlock(obj.data.toString('utf8'))
      }
    }))

    setInterval(fiberUtils.in(() => {
      this._updatePeers()
    }), this.options.peersUpdateInterval)
  }

  _onTransaction(transactionAddress) {
    if (this.isPendingTransaction(transactionAddress)) {
      return
    }

    var stat = this.ipfs.object.statSync(transactionAddress)

    // We check again because fiber could yield in meantime.
    if (this.isPendingTransaction(transactionAddress)) {
      return
    }

    console.log(`New pending transaction: ${transactionAddress}`)
    this._pendingTransactions.push({
      Name: "transaction",
      Hash: transactionAddress,
      Size: stat.BlockSize
    })
  }

  _onBlock(blockAddress) {
    var block = this.getBlock(blockAddress)

    if (!this.isValidChain(block)) {
      return
    }

    if (this._latestBlock && this.getChainLuck(block) <= this.getChainLuck(this._latestBlock)) {
      return
    }

    this._newLatestBlock(block)

    if (this._roundBlock) {
      if (this._latestBlock.getParentLink() !== this._roundBlock.getParentLink()) {
        this._newRound(block)
      }
    }
    else {
      this._newRound(block)
    }
  }

  _newLatestBlock(block) {
    console.log(`New latest block: ${block.getAddress()} (parent ${block.getParentLink()}, luck ${block.getLuck()})`)

    this._latestBlock = block
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
   * Starts a new round. Discards the previous round and resets the interval
   * for committing pending transactions.
   */
  _newRound(roundBlock) {
    if (this._roundCallback) {
      clearInterval(this._roundCallback)
      this._roundCallback = null
    }
    enclave.teeProofOfLuckRoundSync(roundBlock.getPayload().toJSON())
    this._roundBlock = roundBlock
    this._roundCallback = setTimeout(fiberUtils.in(() => {
      this._commitPendingTransactions()
    }), ROUND_TIME * 1000) // ms
  }

  _commitPendingTransactions() {
    var newTransactions = this._pendingTransactions
    this._pendingTransactions = []

    var newPayloadObject = {
      Data: "",
      Links: newTransactions
    }

    if (this._latestBlock) {
      newPayloadObject.Links.push({
        Name: "parent",
        Hash: this._latestBlock.getAddress(),
        Size: this._latestBlock.getCumulativeSize()
      })
    }
    else {
      // To make sure an object has at least some data.
      // We cannot store an object with no data and no links.
      newPayloadObject.Data = "GENESIS"
    }

    var newPayload = new Payload(this, newPayloadObject)

    var newPayloadResponse = this.ipfs.object.putSync(newPayload.toJSON())
    var newPayloadAddress = newPayloadResponse.toJSON().multihash

    newPayload.address = newPayloadAddress

    this._cache.set(newPayloadAddress, newPayload)

    var proof = enclave.teeProofOfLuckMineSync(newPayload.toJSON(), this._latestBlock ? this._latestBlock.toJSON() : null, this._latestBlock ? this._latestBlock.getPayload().toJSON() : null)
    var nonce = enclave.teeProofOfLuckNonce(proof.Quote)

    assert(nonce.hash === newPayloadAddress, `Nonce hash '${nonce.hash}' does not match payload address '${newPayloadAddress}'`)

    var newBlock = new Block(this, {
      Data: JSON.stringify({
        Luck: nonce.luck,
        Proof: {
          Quote: bs58.encode(new Buffer(proof.Quote)),
          Attestation: bs58.encode(new Buffer(proof.Attestation))
        }
      }),
      Links: [{
        Name: "payload",
        Hash: newPayloadAddress,
        Size: newPayload.getCumulativeSize()
      }]
    })

    var newBlockResponse = this.ipfs.object.putSync(newBlock.toJSON())
    var newBlockAddress = newBlockResponse.toJSON().multihash

    newBlock.address = newBlockAddress

    this._cache.set(newBlockAddress, newBlock)

    this.ipfs.pubsub.pubSync(this.getBlocksTopic(), newBlockAddress)
    console.log(`New block mined: ${newBlockAddress} (parent ${newBlock.getParentLink()}, luck ${newBlock.getLuck()}, transactions ${newBlock.getPayload().getTransactionsLinks().length})`)
  }

  _startMining() {
    // It could happen that we already received a block from peers
    // and/or already start a new round.
    if (this._roundCallback || this._roundBlock) {
      return
    }

    // Maybe we loaded the latest block from somewhere, but have
    // not yet started a new around. Let us resume mining from there.
    if (this._latestBlock) {
      var latestBlock = this._latestBlock
      // Sanity check, and to populate the cache.
      if (this.isValidBlock(latestBlock)) {
        throw new Error("Invalid starting latest block")
      }

      // We check that nothing changed because fiber could yield in meantime.
      if (latestBlock === this._latestBlock) {
        this._newRound(latestBlock)
      }
      else {
        // Try again.
        this._startMining()
      }

      return
    }

    // We start a new genesis block. A genesis block does not require to start a round.
    this._commitPendingTransactions()
  }

  isValidChain(block) {
    // TODO: Implement.
    return true
  }

  getChainLuck(block) {
    var luck = 0
    while (block) {
      luck += block.getLuck()
      block = block.getParent()
    }
    return luck
  }

  /**
   * Is a transaction with given address already pending for the next block?
   */
  isPendingTransaction(address) {
    for (var transaction of this._pendingTransactions) {
      if (transaction.Hash === address) {
        return true
      }
    }
    return false
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
      this.ipfs.pubsub.pubSync(this.getTransactionsTopic(), data)
      console.log(`New transaction with address: ${data}`)
    }
    catch (error) {
      res.status(400).json({error: "error"})
      throw error
    }
    res.status(200).json({message: "success", address: data})
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

    this._onNewTransactionAddress(response.toJSON().multihash, res)
  }
}

module.exports = function blockchain(node, options) {
  fiberUtils.in(() => {
    new Blockchain(node, options).start()
  })()
}
