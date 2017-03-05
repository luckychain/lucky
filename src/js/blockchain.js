var _ = require('underscore')
var assert = require('assert')
var socketIo = require('socket.io')
var IPFS = require('ipfs-api')
var isIPFS = require('is-ipfs')
var bs58 = require('bs58')
var dagPB = require('ipld-dag-pb')
var enclave = require('./enclave')
var FiberUtils = require('./fiber-utils')
var clone = require('clone')

var enclaveInstance = null

var DAGNodeCreateSync = FiberUtils.wrap(dagPB.DAGNode.create)

var ROUND_TIME = 10 // seconds
var BLOCKCHAIN_ID = "lucky-chain-0.1"

var DEFAULT_OPTIONS = {
  clientPort: 8000,
  ipfsOptions: {
    host: "localhost",
    port: "5001",
    protocol: "http"
  },
  blockchainId: BLOCKCHAIN_ID,
  peersUpdateInterval: 15 // s
}

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
    return clone(this.object)
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
  // Constructor validates the block and its whole chain and throws an exception if anything is invalid.
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
    if (!_.isString(this.data.Time)) {
      throw new Error("Invalid timestamp")
    }

    this.data.Proof.Attestation = new Uint8Array(bs58.decode(this.data.Proof.Attestation)).buffer
    this.data.Proof.Quote = new Uint8Array(bs58.decode(this.data.Proof.Quote)).buffer
    this.data.Time = new Date(this.data.Time)

    if (!enclaveInstance.teeValidateRemoteAttestation(this.data.Proof.Quote, this.data.Proof.Attestation)) {
      throw new Error("Invalid attestation")
    }

    var nonce = enclaveInstance.teeProofOfLuckNonce(this.data.Proof.Quote)

    if (nonce.luck !== this.data.Luck) {
      throw new Error("Proof's luck does not match block's luck")
    }
    if (nonce.hash !== this.getPayloadLink()) {
      throw new Error("Proof's payload does not match block's payload")
    }

    // Creating payload and parent objects validates them as well.
    // This happens recursively over the whole chain. Because objects are cached we do not
    // have to necessary recompute and validate the whole chain again and again.
    this.getPayload()
    this.getParent()

    this.chainLuck = this._computeChainLuck()
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

  getTimestamp() {
    return this.data.Time
  }

  getParentLink() {
    return this.getPayload().getParentLink()
  }

  getParent() {
    return this.getPayload().getParent()
  }

  _computeChainLuck() {
    var luck = this.getLuck()
    var parent = this.getParent()
    if (parent) {
      luck += parent.getChainLuck()
    }
    return luck
  }

  getChainLuck() {
    return this.chainLuck
  }

  pinChain(previousLatestBlock) {
    FiberUtils.synchronize(this.blockchain, 'pinChain', () => {
      var previousChainIDs = []
      while (previousLatestBlock) {
        previousChainIDs.push(previousLatestBlock.address)
        previousChainIDs.push(previousLatestBlock.getPayloadLink())
        previousLatestBlock = previousLatestBlock.getParent()
      }

      var newChainIDs = []
      var block = this
      while (block) {
        newChainIDs.push(block.address)
        newChainIDs.push(block.getPayloadLink())
        block = block.getParent()
      }

      for (var address of _.difference(newChainIDs, previousChainIDs)) {
        this.blockchain.ipfs.pin.addSync(address, {recursive: false})
      }

      for (var address of _.difference(previousChainIDs, newChainIDs)) {
        this.blockchain.ipfs.pin.rmSync(address, {recursive: false})
      }
    })
  }

  // Records in IPNS are stored signed with our key, so they cannot be faked, but they could
  // be reverted to old values. We use this as an optimization anyway, to better know where to
  // start initially, but it is not really needed. In the worst case a peer will quickly learns
  // about new latest block.
  rememberInIPNS() {
    // TODO: Implement. Store current block into IPNS.
  }

  toString() {
    return `${this.getAddress()} (parent ${this.getParentLink()}, luck ${this.getLuck()}, time ${this.getTimestamp()}, transactions ${this.getPayload().getTransactionsLinks().length})`
  }
}

class Blockchain {
  constructor(node, options) {
    this.node = node
    this.options = _.defaults(options || {}, DEFAULT_OPTIONS)

    this._cache = new Map()

    this.ipfs = new IPFS(this.options.ipfsOptions)

    this.ipfs.idSync = FiberUtils.wrap(this.ipfs.id)
    this.ipfs.object.getSync = FiberUtils.wrap(this.ipfs.object.get)
    this.ipfs.object.putSync = FiberUtils.wrap(this.ipfs.object.put)
    this.ipfs.object.statSync = FiberUtils.wrap(this.ipfs.object.stat)
    this.ipfs.pin.addSync = FiberUtils.wrap(this.ipfs.pin.add)
    this.ipfs.pin.rmSync = FiberUtils.wrap(this.ipfs.pin.rm)
    this.ipfs.pubsub.pubSync = FiberUtils.wrap(this.ipfs.pubsub.pub)
    this.ipfs.pubsub.subSync = FiberUtils.wrap(this.ipfs.pubsub.sub)
    this.ipfs.pubsub.peersSync = FiberUtils.wrap(this.ipfs.pubsub.peers)
    this.ipfs.name.publishSync = FiberUtils.wrap(this.ipfs.name.publish)
    this.ipfs.name.resolveSync = FiberUtils.wrap(this.ipfs.name.resolve)

    this.peers = new Map()

    this._pendingTransactions = []
    this._roundBlock = null
    this._roundCallback = null
    // Latest block represents currently known best chain.
    // It can be different from round block if it shares the same parent.
    this._latestBlock = null
    this._miningResult = null
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
    this._restoreFromIPNS()
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
      json.Hash = block.address
      json.Data = JSON.parse(json.Data)
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

      socket.on('peers', FiberUtils.in(() => {
        socket.emit('peersResult', this.getPeers())
      }))

      socket.on('chain', FiberUtils.in(() => {
        socket.emit('chainResult', this.getChain())
      }))
    })

    this.node.get("/peers", FiberUtils.in((req, res, next) => {
      res.status(200).json({
        peers: this.getPeers()
      })
    }))

    this.node.get("/chain", FiberUtils.in((req, res, next) => {
      res.status(200).json({
        chain: this.getChain()
      })
    }))

    this.node.post("/tx", FiberUtils.in((req, res, next) => {
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
    transactions.on('data', FiberUtils.in((obj) => {
      if (obj.data) {
        this._onTransaction(obj.data.toString('utf8'))
      }
    }))
    var blocks = this.ipfs.pubsub.subSync(this.getBlocksTopic(), {discover: true})
    blocks.on('data', FiberUtils.in((obj) => {
      if (obj.data) {
        this._onBlock(obj.data.toString('utf8'))
      }
    }))

    setInterval(FiberUtils.in(() => {
      this._updatePeers()
    }), this.options.peersUpdateInterval * 1000) // ms
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

    // TODO: Pub/sub should broadcast this transaction only now.
    //       Currently pub/sub broadcasts every transaction fully to everyone. We want that only if a
    //       transaction has been processed to the end here, this node broadcasts it further. Eg., it could be
    //       that the transaction has been already known and so it has already broadcast it before, so it does not
    //       have to do it now again.
    //       See: https://github.com/ipfs/go-ipfs/issues/3741
  }

  _onBlock(blockAddress) {
    // Block constructor also validates the whole chain.
    var block = this.getBlock(blockAddress)

    // getBlock can yield, but it does not matter, we can still compare.
    if (this._latestBlock && block.getChainLuck() <= this._latestBlock.getChainLuck()) {
      return
    }

    assert(!this._roundBlock || !this._latestBlock || this._latestBlock.getParentLink() === this._roundBlock.getParentLink(), "Latest's block parent link is not the same as round's block parent link")

    // We have already mined a block and are sleeping before releasing it. It is strange that we would get a block
    // extending current chain before we released our block, if our block is luckier than the block we just received.
    // So we check for this special case and ignore such blocks, because once we release our block the chain for everyone
    // will switch to this our chain anyway. If we were not ignore it, this block would trigger a new round and our mining
    // of luckier block would be terminated.
    if (this._roundBlock && this._latestBlock && this._miningResult && _.isFinite(this._miningResult.luck) && block.getParent().getParentLink() === this._roundBlock.getParentLink() && (block.getLuck() + block.getParent().getLuck() < this._miningResult.luck + this._latestBlock.getLuck())) {
      console.log(`Received new luckier latest block out of order, ignoring: ${block}`)
      return
    }

    console.log(`New latest block: ${block}`)

    var previousLatestBlock = this._latestBlock
    this._latestBlock = block

    if (this._roundBlock) {
      // If during a mining on a round block we get a better chain, we do not switch to mining on this better chain
      // if the parent of both blocks is the same. This can happen if the chain was prolonged and we start mining
      // on it, but then a delayed best chain from the previous round arrives. Chains are equal up to the last block.
      if (this._latestBlock.getParentLink() !== this._roundBlock.getParentLink()) {
        this._newRound(block)
      }
    }
    else {
      this._newRound(block)
    }

    // _newRound could yield, so we make sure we still have the same latest block.
    if (this._latestBlock !== block) {
      return
    }

    // TODO: Pub/sub should broadcast this block only now.
    //       Currently pub/sub broadcasts every block fully to everyone. We want that only if a block has been
    //       processed to the end here, this node broadcasts it further. Eg., it could be that the block represents
    //       a chain which is invalid or less lucky than currently known best (latest) chain.
    //       See: https://github.com/ipfs/go-ipfs/issues/3741

   this._latestBlock.pinChain(previousLatestBlock)

    // We could yield, so we compare.
    if (this._latestBlock !== block) {
      return
    }

    this._latestBlock.rememberInIPNS()
  }

  _updatePeers() {
    var transactionsPeers = this.ipfs.pubsub.peersSync(this.getTransactionsTopic())
    var blocksPeers = this.ipfs.pubsub.peersSync(this.getBlocksTopic())

    var peers = _.union(transactionsPeers, blocksPeers)

    var added = 0
    var removed = 0

    for (var peer of peers) {
      if (!this.peers.has(peer)) {
        this.peers.set(peer, this.ipfs.idSync(peer))
        added++
      }
    }

    for (var peer of this.peers.keys()) {
      if (_.indexOf(peers, peer) === -1) {
        this.peers.delete(peer)
        removed++
      }
    }

    if (added || removed) {
      console.log(`Peers updated: ${added} added, ${removed} removed, ${this.peers.size} total`)
    }
  }

  /**
   * Starts a new round. Discards the previous round and resets the interval
   * for committing pending transactions.
   */
  _newRound(roundBlock) {
    // This can potentially be called quickly one after the other, if many new latest block are arriving.
    // Because teeProofOfLuckRoundSync yields, we want to assure is consistent and calls to _newRound are queued.
    FiberUtils.synchronize(this, '_newRound', () => {
      if (this._roundCallback) {
        clearTimeout(this._roundCallback)
        this._roundCallback = null
      }
      if (this._miningResult) {
        this._miningResult.cancel()
        this._miningResult = null
      }
      enclaveInstance.teeProofOfLuckRoundSync(roundBlock.getPayload().toJSON())
      this._roundBlock = roundBlock
      this._roundCallback = setTimeout(FiberUtils.in(() => {
        this._commitPendingTransactions()
      }), ROUND_TIME * 1000) // ms
    })
  }

  _commitPendingTransactions() {
    // This should be called only every ROUND_TIME seconds, but just to be sure no two calls happen
    // in parallel we are making it a critical section. This one prematurely ends when mining is canceled,
    // so there should not really be any calls queued.
    FiberUtils.synchronize(this, '_commitPendingTransactions', () => {
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

      assert(!this._miningResult, "this._miningResult is set")

      var proof
      var result = enclaveInstance.teeProofOfLuckMineSync(newPayload.toJSON(), this._latestBlock ? this._latestBlock.toJSON() : null, this._latestBlock ? this._latestBlock.getPayload().toJSON() : null)

      assert(!this._miningResult, "this._miningResult is set")
      this._miningResult = result

      try {
        proof = result.future.wait()
        // If mining was canceled.
        if (!proof) {
          return
        }
      }
      finally {
        this._miningResult = null
      }

      var nonce = enclaveInstance.teeProofOfLuckNonce(proof.Quote)

      assert(nonce.hash === newPayloadAddress, `Nonce hash '${nonce.hash}' does not match payload address '${newPayloadAddress}'`)

      var newBlock = new Block(this, {
        Data: JSON.stringify({
          Luck: nonce.luck,
          Proof: {
            Quote: bs58.encode(new Buffer(proof.Quote)),
            Attestation: bs58.encode(new Buffer(proof.Attestation))
          },
          // Not trusted timestamp.
          Time: new Date()
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
      console.log(`New block mined: ${newBlock}`)
    })
  }

  _restoreFromIPNS() {
    // TODO: Implement. Set this._latestBlock to the block from IPNS.
  }

  _startMining() {
    // It could happen that we already received a block from peers
    // and/or already start a new round.
    if (this._roundCallback || this._roundBlock) {
      return
    }

    // Maybe we restored the latest block from somewhere, like IPNS, but have
    // not yet started a new around. Let us resume mining from there.
    if (this._latestBlock) {
      this._newRound(this._latestBlock)
      return
    }

    // We start a new genesis block. A genesis block does not require to start a round.
    this._commitPendingTransactions()
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
      this.ipfs.pin.addSync(response.toJSON().multihash, {recursive: false})
    }
    catch (error) {
      res.status(400).json({error: "error"})
      throw error
    }

    this._onNewTransactionAddress(response.toJSON().multihash, res)
  }
}

module.exports = function blockchain(node, options) {
  FiberUtils.ensure(() => {
    if (!enclaveInstance) {
      enclaveInstance = enclave()
    }

    new Blockchain(node, options).start()
  })
}

module.exports.DEFAULT_OPTIONS = DEFAULT_OPTIONS
