'use strict'

const PeerId = require('peer-id')
const PeerInfo = require('peer-info')
const bs58 = require('bs58')
const multiaddr = require('multiaddr')
const libp2pIPFS = require('libp2p-ipfs')
const series = require('run-series')

const PSG = require('../')

let node
let ps

function bootNode(next) {
  // const id = PeerId.createFromJSON(require('./subscriber-id'))
  const id = PeerId.create({ bits: 2048 })
  console.log(id.toJSON());
  const peer = new PeerInfo(id)
  peer.multiaddr.add(multiaddr('/ip4/0.0.0.0/tcp/12367'))
  node = new libp2pIPFS.Node(peer)
  node.start((err) => {
    if (err) {
      throw err
    }

    console.log('Subscriber listening on:')

    peer.multiaddrs.forEach((ma) => {
      console.log(ma.toString() + '/ipfs/' + id.toB58String())
    })

    next(err)
  })
}

function setUpPS(next) {
  console.log('attaching pubsub')
  ps = new PSG(node)
  next()
}

function listen () {
  ps.on('interop', (data) => {
    console.log(data.toString('utf8'))
  })

  ps.subscribe('interop')

  // const idPublisher = PeerId.createFromJSON(require('./publisher-id'))
  const idPublisher = PeerId.createFromJSON(require('../../../../storage/pubsub'))
  const peerPublisher = new PeerInfo(idPublisher)
  peerPublisher.multiaddr.add(multiaddr('/ip4/0.0.0.0/tcp/10333'))
  
  ps.connect(peerPublisher)
}

series([
  bootNode,
  setUpPS
], listen)
