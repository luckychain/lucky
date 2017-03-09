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
var LRU = require('lru-cache')

Error.stackTraceLimit = 100

var enclaveInstance = null

var DAGNodeCreateSync = FiberUtils.wrap(dagPB.DAGNode.create)

var ROUND_TIME = 10 // seconds
var BLOCKCHAIN_ID = "lucky-chain-0.1"

var DEFAULT_OPTIONS = {
  clientPort: 8000,
  ipfsOptions: {
    host: "localhost",
    port: 5001,
    protocol: "http"
  },
  blockchainId: BLOCKCHAIN_ID,
  peersUpdateInterval: 15, // s
  latestBlockHash: null,
  maxObjectCacheSize: 500 * 1024 * 1024, // B
  maxValidationCacheSize: 100 * 1024 * 1024 // B
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

    // TODO: We could cache size as a value in _validatedChains cache.
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
  // Constructor validates only the payload.
  // It throws an exception if anything is invalid.
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
  // Constructor validates only the block and not its whole chain.
  // It throws an exception if anything is invalid.
  constructor(blockchain, object, address) {
    super(blockchain, object, address)

    // Maybe we validated it before, but cached node expired.
    this._validatedChain = address && this.blockchain._validatedChains.get(address) || false

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
    if (!isIPFS.multihash(this.data.MinerId)) {
      throw new Error("Invalid miner ID")
    }
    if (!_.isFinite(this.data.ChainLength)) {
      throw new Error(`Invalid chain length: ${this.data.ChainLength}`)
    }
    if (!_.isFinite(this.data.ChainLuck)) {
      throw new Error(`Invalid chain luck: ${this.data.ChainLuck}`)
    }

    this.data.Proof.Attestation = new Uint8Array(bs58.decode(this.data.Proof.Attestation)).buffer
    this.data.Proof.Quote = new Uint8Array(bs58.decode(this.data.Proof.Quote)).buffer
    this.data.Time = new Date(this.data.Time)

    // Chain could be validated before.
    if (!this._validatedChain) {
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

      // Forces fetch of the payload and its validation.
      this.getPayload()
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

  getTimestamp() {
    return this.data.Time
  }

  getMinerId() {
    return this.data.MinerId
  }

  getChainLength() {
    return this.data.ChainLength
  }

  getChainLuck() {
    return this.data.ChainLuck
  }

  getParentLink() {
    return this.getPayload().getParentLink()
  }

  getParent() {
    return this.getPayload().getParent()
  }

  _setValidatedChain() {
    this.blockchain._validatedChains.set(this.address, true)
    this._validatedChain = true
  }

  validateChain() {
    if (this._validatedChain) {
      return
    }

    var childBlock
    var parentBlock
    var allSize = this.getCumulativeSize()
    var lastReported = new Date()
    var reported = false

    try {
      for (childBlock = this, parentBlock = this.getParent(); parentBlock; childBlock = parentBlock, parentBlock = parentBlock.getParent()) {
        // The order of operations has to match how chain luck is computed when building
        // a block because floating point addition is not commutative.
        if (childBlock.getChainLength() !== parentBlock.getChainLength() + 1) {
          throw new Error("Chain length does not match between blocks")
        }
        if (childBlock.getChainLuck() !== parentBlock.getChainLuck() + childBlock.getLuck()) {
          throw new Error("Chain luck does not match between blocks")
        }

        // We can stop if we reached any block which has had its chain validated.
        if (parentBlock._validatedChain) {
          break
        }

        // If during processing of a chain we get to another chain being processed,
        // we wait for that one to finish first.
        var uniqueId = `_onBlock/${parentBlock.address}`
        var guards = this.blockchain._guards
        if (guards[uniqueId]) {
          guards[uniqueId].exit(guards[uniqueId].enter())
          if (guards[uniqueId] && !guards[uniqueId].isInUse()) {
            delete guards[uniqueId]
          }
        }

        // If we waited for the block's chain to be processed, it is now validated and we can break.
        if (parentBlock._validatedChain) {
          break
        }

        var timestamp = new Date()
        if (timestamp.valueOf() - lastReported.valueOf() > 120 * 1000) { // ms
          reported = true
          lastReported = timestamp
          var sizeProcessed = allSize - (parentBlock.getCumulativeSize() - parentBlock.getBlockSize() - parentBlock.getPayload().getBlockSize())
          console.log(`Processing chain ${this.address}, ${sizeProcessed} of ${allSize} bytes, ${Math.round(sizeProcessed / allSize * 10000) / 100}%`)
        }
      }

      // Cover the edge case for a genesis block.
      if (!parentBlock) {
        assert(!childBlock.getParentLink(), "No parent but parent link")

        if (childBlock.getChainLength() !== 1) {
          throw new Error("Genesis block's chain length is not 1")
        }
        if (childBlock.getChainLuck() !== childBlock.getLuck()) {
          throw new Error("Genesis block's chain luck is not its luck")
        }
      }

      // We got to the end of the chain, or to an already validated chain. We can
      // now mark all blocks until there as having a validated chain validated as well.
      for (parentBlock = this.getParent(); parentBlock && !parentBlock._validatedChain; parentBlock = parentBlock.getParent()) {
        parentBlock._setValidatedChain()
      }

      if (reported) {
        console.log(`Chain ${this.address} processed`)
      }
    }
    catch (error) {
      if (reported) {
        console.log(`Processing of chain ${this.address} failed`)
      }

      // Code calling this method will log the error.
      throw error
    }

    this._setValidatedChain()
  }

  pinChain(previousLatestBlock) {
    FiberUtils.synchronize(this.blockchain, 'pinChain', () => {
      var newChainIDs = []
      var previousChainIDs = []

      var block = this
      // We iterate over both chains together because often at some point they share a block.
      while (block || previousLatestBlock) {
        if (block) {
          newChainIDs.push(block.address)
          newChainIDs.push(block.getPayloadLink())
          block = block.getParent()
        }

        if (previousLatestBlock) {
          previousChainIDs.push(previousLatestBlock.address)
          previousChainIDs.push(previousLatestBlock.getPayloadLink())
          previousLatestBlock = previousLatestBlock.getParent()
        }

        // We found a point where chains share a block. We do not have to continue.
        if (_.intersection(newChainIDs, previousChainIDs)) {
          break
        }
      }

      var add = _.difference(newChainIDs, previousChainIDs)
      var remove = _.difference(previousChainIDs, newChainIDs)

      for (var i = 0; i < add.length; i += 5000) {
        this.blockchain.ipfs.pin.addSync(add.slice(i, i + 5000), {recursive: false})
      }
      for (var i = 0; i < remove.length; i += 5000) {
        this.blockchain.ipfs.pin.rmSync(remove.slice(i, i + 5000), {recursive: false})
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
    return `${this.getAddress()} (parent ${this.getParentLink()}, luck ${this.getLuck()}, time ${this.getTimestamp()}, miner ${this.getMinerId()}, transactions ${this.getPayload().getTransactionsLinks().length})`
  }
}

class Blockchain {
  constructor(node, options) {
    this.node = node

    // Remove NaN values which are set by yargs when option could not be parsed into a number.
    options = _.omit(options || {}, _.isNaN)

    this.options = _.defaults(options, DEFAULT_OPTIONS)

    this.options.blockchainId = `${this.options.blockchainId}/${this.getSGXVersion() && !this.options.noSgx ? 'sgx' : 'mock'}`

    this._cache = LRU({
      max: this.options.maxObjectCacheSize,
      length: (value, key) => {
        return key.length + value.getBlockSize()
      }
    })
    this._validatedChains = new LRU({
      max: this.options.maxValidationCacheSize,
      length: (value, key) => {
        return key.length
      }
    })

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
      // We synchronize based on the argument to prevent executing the method for the same argument in parallel.
      FiberUtils.synchronize(this, `_getNode/${address}`, () => {
        // We check again because it might be that while we were synchronizing another call populated the cache.
        // We synchronize inside the if statement so that for the common case (object already in the cache) we do
        // not even try to synchronize.
        if (this._cache.has(address)) {
          return
        }

        var node = this._getNode(address)
        var payload = new Payload(this, node, address)

        this._cache.set(address, payload)
      })
    }

    var payload = this._cache.get(address)
    assert(payload instanceof Payload)
    return payload
  }

  getBlock(address) {
    if (!this._cache.has(address)) {
      // We synchronize based on the argument to prevent executing the method for the same argument in parallel.
      FiberUtils.synchronize(this, `_getNode/${address}`, () => {
        // We check again because it might be that while we were synchronizing another call populated the cache.
        // We synchronize inside the if statement so that for the common case (object already in the cache) we do
        // not even try to synchronize.
        if (this._cache.has(address)) {
          return
        }

        var node = this._getNode(address)
        var block = new Block(this, node, address)

        this._cache.set(address, block)
      })
    }

    var block = this._cache.get(address)
    assert(block instanceof Block)
    return block
  }

  _getNode(address) {
    return this.ipfs.object.getSync(address).toJSON()
  }

  start() {
    console.log(`Starting ${this.options.blockchainId}`)

    this._getIPFSInfo()
    this._restoreFromIPNS()
    this._startPubSub()
    this._startWebInterface()
    this._startMining()
  }

  getPeers() {
    return Array.from(this.peers.values())
  }

  getChain(limit) {
    var chain = []
    var hasMore = false

    var block = this._latestBlock
    for (var i = 0; block && i < limit; i++) {
      var json = block.toJSON()
      json.Hash = block.address
      json.Data = JSON.parse(json.Data)
      json.Links[0].Content = block.getPayload().toJSON()
      chain.push(json)
      block = block.getParent()
    }
    if (block && block.getParentLink()) {
      hasMore = true
    }

    return {
      chain: chain,
      hasMore: hasMore
    }
  }

  getChainLength() {
    if (this._latestBlock) {
      return this._latestBlock.getChainLength()
    }
    else {
      return 0
    }
  }

  getPendingTransactions() {
    return this._pendingTransactions
  }

  getSGXVersion() {
    // TODO: We should return SGX version (version of platform, enclave, etc.). And null for mock.
    // TODO: We should pass this as part of the node's ID, and make it available as part of peers' ID.
    //       See: https://github.com/ipfs/notes/issues/227
    return null
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

      socket.on('id', FiberUtils.in(() => {
        socket.emit('idResult', this.options.blockchainId)
      }, this, this._handleErrors))

      socket.on('peers', FiberUtils.in(() => {
        socket.emit('peersResult', this.getPeers())
      }, this, this._handleErrors))

      socket.on('chain', FiberUtils.in((args) => {
        var limit = args && args.limit && parseInt(args.limit) || 100
        if (_.isFinite(limit) && limit >= 0) {
          socket.emit('chainResult', this.getChain(limit))
        }
      }, this, this._handleErrors))

      socket.on('length', FiberUtils.in(() => {
        socket.emit('lengthResult', this.getChainLength())
      }, this, this._handleErrors))

      socket.on('pending', FiberUtils.in(() => {
        socket.emit('pendingResult', this.getPendingTransactions())
      }, this, this._handleErrors))
    })

    this.node.get("/api/v0/id", FiberUtils.in((req, res, next) => {
      res.status(200).json({
        id: this.options.blockchainId
      })
    }, this, this._handleErrors))

    this.node.get("/api/v0/peers", FiberUtils.in((req, res, next) => {
      res.status(200).json({
        peers: this.getPeers()
      })
    }, this, this._handleErrors))

    this.node.get("/api/v0/chain", FiberUtils.in((req, res, next) => {
      var limit = req.query.limit && parseInt(req.query.limit) || 100
      if (_.isFinite(limit) && limit >= 0) {
        res.status(200).json(this.getChain(limit))
      }
      else {
        res.status(400).json({error: "invalid"})
      }
    }, this, this._handleErrors))

    this.node.get("/api/v0/length", FiberUtils.in((req, res, next) => {
      res.status(200).json({
        length: this.getChainLength()
      })
    }, this, this._handleErrors))

    this.node.get("/api/v0/pending", FiberUtils.in((req, res, next) => {
      res.status(200).json({
        pending: this.getPendingTransactions()
      })
    }, this, this._handleErrors))

    this.node.post("/api/v0/tx", FiberUtils.in((req, res, next) => {
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
    }, this, this._handleErrors))

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
    }, this, this._handleErrors))
    var blocks = this.ipfs.pubsub.subSync(this.getBlocksTopic(), {discover: true})
    blocks.on('data', FiberUtils.in((obj) => {
      if (obj.data) {
        this._onBlock(obj.data.toString('utf8'))
      }
    }, this, this._handleErrors))

    setInterval(FiberUtils.in(() => {
      this._updatePeers()
    }, this, this._handleErrors), this.options.peersUpdateInterval * 1000) // ms
  }

  _onTransaction(transactionAddress) {
    // We synchronize based on the argument to prevent executing the method for the same argument in parallel.
    FiberUtils.synchronize(this, `_onTransaction/${transactionAddress}`, () => {
      if (this.isPendingTransaction(transactionAddress)) {
        return
      }

      var stat = this.ipfs.object.statSync(transactionAddress)

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

      this.socketIo.emit('pendingResult', this.getPendingTransactions())
    })
  }

  _onBlock(blockAddress) {
    // We synchronize based on the argument to prevent executing the method for the same argument in parallel.
    FiberUtils.synchronize(this, `_onBlock/${blockAddress}`, () => {
      var block = this.getBlock(blockAddress)

      // Validation also downloads the whole chain into our cache.
      block.validateChain()

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
      if (this._roundBlock && this._latestBlock && this._miningResult && _.isFinite(this._miningResult.luck) && block.getParent() && block.getParent().getParentLink() === this._roundBlock.getParentLink() && (block.getLuck() + block.getParent().getLuck() < this._miningResult.luck + this._latestBlock.getLuck())) {
        console.log(`Received new luckier latest block out of order, ignoring: ${block}`)
        return
      }

      console.log(`New latest block: ${block}`)

      var previousLatestBlock = this._latestBlock
      this._latestBlock = block

      this.socketIo.emit('chainUpdated')

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
    })
  }

  _updatePeers() {
    // Not really serious if it would be called in parallel, but let us still prevent it.
    // TODO: A call in parallel should just terminate instead of being queued.
    FiberUtils.synchronize(this, '_updatePeers', () => {
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
        this.socketIo.emit('peersResult', this.getPeers())
      }
    })
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
      }, this, this._handleErrors), ROUND_TIME * 1000) // ms
    })
  }

  _commitPendingTransactions() {
    // This should be called only every ROUND_TIME seconds, but just to be sure no two calls happen
    // in parallel we are making it a critical section. This one prematurely ends when mining is canceled,
    // so there should not really be any calls queued.
    FiberUtils.synchronize(this, '_commitPendingTransactions', () => {
      // TODO: IPFS objects are limited to 1 MB in size. We should take this into consideration.
      //       We could for example take pop only as many pending transactions as they can get into 1 MB and leave others
      //       for later blocks. Or we could support multiple payload objects per one block. Or (more backwards compatible)
      //       payload could reference the next or more other payloads with a "payload" link among its links.
      var newTransactions = this._pendingTransactions
      this._pendingTransactions = []

      // We store it into a variable now, because it could change while we are committing pending transactions.
      var latestBlock = this._latestBlock
      var roundBlock = this._roundBlock

      var newPayloadObject = {
        Data: "",
        Links: newTransactions
      }

      if (latestBlock) {
        newPayloadObject.Links.push({
          Name: "parent",
          Hash: latestBlock.getAddress(),
          Size: latestBlock.getCumulativeSize()
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

      var result = null

      // We have to make sure round block does not change during mining.
      FiberUtils.synchronize(this, '_newRound', () => {
        assert(!this._miningResult, "this._miningResult is set")

        // Round has changed since the start (code can yield). We cannot mine anymore within this round.
        if ((roundBlock && roundBlock.getParentLink()) !== (this._roundBlock && this._roundBlock.getParentLink())) {
          return
        }

        result = enclaveInstance.teeProofOfLuckMineSync(newPayload.toJSON(), latestBlock ? latestBlock.toJSON() : null, latestBlock ? latestBlock.getPayload().toJSON() : null)
      })

      if (!result) {
        // TODO: What should we do with our pending transactions? What if they were not included in the winning block?
        //       Should we try to put them back to be mined with the next block? But how to prevent/detect duplicates
        //       because currently we allow same transactions in the chain, but just not in the same block.
        return
      }

      assert(!this._miningResult, "this._miningResult is set")
      this._miningResult = result

      var proof = null

      try {
        // We have to wait before the enclave releases the proof.
        proof = result.future.wait()
        // If mining was canceled.
        if (!proof) {
          // TODO: What should we do with our pending transactions? What if they were not included in the winning block?
          //       Should we try to put them back to be mined with the next block? But how to prevent/detect duplicates
          //       because currently we allow same transactions in the chain, but just not in the same block.
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
          Time: new Date(),
          // Not trusted miner ID.
          // TODO: Make peer sign the block, so that the identity cannot be forged.
          //       See: https://github.com/ipfs/interface-ipfs-core/issues/120
          MinerId: this.ipfsInfo.id,
          ChainLength: latestBlock ? latestBlock.getChainLength() + 1 : 1,
          ChainLuck: latestBlock ? latestBlock.getChainLuck() + nonce.luck : nonce.luck
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

      this.socketIo.emit('pendingResult', this.getPendingTransactions())
    })
  }

  _restoreFromIPNS() {
    // TODO: Implement. Set this._latestBlock to the block from IPNS.
    // Override.
    if (this.options.latestBlockHash) {
      console.log(`Starting with the latest block: ${this.options.latestBlockHash}`)
      var block = this.getBlock(this.options.latestBlockHash)
      block.validateChain()
      console.log(`The latest block: ${block.toString()}`)
      this._latestBlock = block
    }
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
      res.status(400).json({error: "invalid", message: "Not a valid IPFS address"})
      return
    }

    // We do not want duplicate transactions in the same block,
    // but we do allow duplicate transactions across blocks.
    // This is an arbitrary design decision for this implementation.
    if (this.isPendingTransaction(data)) {
      res.status(400).json({error: "pending", message: "Transaction is already pending"})
      return
    }

    try {
      this.ipfs.pubsub.pubSync(this.getTransactionsTopic(), data)
      console.log(`New transaction with address: ${data}`)
    }
    catch (error) {
      res.status(400).json({error: "error", message: `${error}`})
      throw error
    }
    res.status(200).json({address: data})
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
      res.status(400).json({error: "error", message: `${error}`})
      throw error
    }

    this._onNewTransactionAddress(response.toJSON().multihash, res)
  }

  _handleErrors(error) {
    console.error("Exception during execution, continuing", error)
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
