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
  const id = PeerId.createFromJSON(require('./publisher-id'))
  const peer = new PeerInfo(id)
  peer.multiaddr.add(multiaddr('/ip4/0.0.0.0/tcp/10333'))
  node = new libp2pIPFS.Node(peer)
  node.start((err) => {
    if (err) {
      throw err
    }

    console.log('Publisher listening on:')

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

function publishMsg(err) {
  if (err) {
    throw err
  }
  
  setInterval(() => {
    process.stdout.write('.')
    ps.publish('interop', new Buffer('hey, how is it going?'))
  }, 300)
}

series([
  bootNode,
  setUpPS
], publishMsg)

