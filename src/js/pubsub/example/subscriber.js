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
  const id = PeerId.createFromJSON(require('./subscriber-id'))
  // const id = PeerId.create({ bits: 2048 })
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
  ps.subscribe('interop')

  ps.subscribe('block')
  
  ps.subscribe('transaction')

  ps.on('interop', (data) => {
    console.log(data.toString('utf8'))
  })

  ps.on('block', (data) => {
    console.log(data.toString('utf8'))
  })

  // const idPublisher = PeerId.createFromJSON(require('./publisher-id'))
  // const idPublisher = PeerId.createFromJSON(require('../../../../storage/pubsub'))
  // const idPublisher = PeerId.createFromB58String('Qma3GsJmB47xYuyahPZPSadh1avvxfyYQwk8R3UnFrQ6aP')

  const idPublisher = PeerId.createFromJSON({
    "id": "QmTvzVUurS91zTQ3y7GyTk3w6VzKPq8bF9z5oKVmiK9czf",
    "privKey": "CAASpgkwggSiAgEAAoIBAQD5ZH+GVM+hqrABL/QkGmuXUbwXqjeEpi/HkUb2452m1hKXiUUvWLKrUuGhg/kYBYsiqz32p6JpyaUrSr/QGAB8y8UrKxqsIhVqHcGlttxTfD8i4sDju8mHlPu/3q5w/ZPABwMiyyL8G+y5cIsiKGCF480VwiDgYodirTXrmRb0yGAMZf0OBr6pcaCqCuqPyVJPxC0Kk8u1WUXfnkxQ0bfQITf0KC+fIBKvOIaWMzSWDSaOFcwQI5a2u8x0Wun83usiIx/OqUMEJifxoY7kEtMkvYKY84PoZA52yb9MIAsY+kv7tnXUAN6x7I9nklGYjgPcAu4PBkKe9Q5CDyTP1pqfAgMBAAECggEAFYP8FITAnPvyz0dp0quM2LMufQQsYf9MY/U+oBInCbuyQuyO0XTfhTRTTvHpzY684DLR17PCqUnCPCfowHUxpZKW4hCH7o3KNyt2B2vtOi6f68yQQ5Vx34aU6Yq2lfzqgEialqfbztBB7gWtmzbMjQCIMvZai8E0WOkEm9zLRDbRqIXEJDs3Z9TSnSIFOduqsNOl8HfiXJrLqYdd52orqhEiBxoKs53XKUjT63did+NIFPLSgY/yWpEfNQmH3fU4waO7k1NV1PEC3EP67OEqe8ghM/KChCpEtBsvuU55m2u8k4QKaFPkHOJcOQXdghQwxnBo2IleQjc5UdXeFJmw8QKBgQD/1lFKtG7Fo+DxEmjVPHmUl6GDkR5yt9Z+KrbVJ4bBCRonN2XNdyXk2ulIrSSTSuENEWFna/S6Jr/ozvM9W6xu50vFZbU5NNqXT7GtfGdYH0DfeSUE+wbTcb25bqDt2uAJJrEQ4PQFxifrcT6cwju7rHAVbrtj7Ryb810upCQkAwKBgQD5jSFvVtDEc8K+LHo5An7lRQYxZIxPpBSP6O1JZTyyq0gUcIIwRo94NwPvkRGfEA0KWp1qsO5MpY9S10R/dziFJ+ScGvGhqJcBravRyl79eAL6DcySum/BS93BvsoNfZySAuea51ri2NIVRl+56SuqrnqE6P+sRjLXgBWqt4ZiNQKBgCpS8FvlgbXcqKf5HbK5MHvuod+8MEdWNnvk4R5eTaK9uL/oIEVfgrtbo+BMFJLxfk3FJFIRwAjTxEflhMQP2HT4esaLTvHJ1qfVnVVQEWC4uui9h+xNAxIT7QkyThlLbmjVJ9HdBUG3SH9g2rTgRTWFD33cNdAQN/1sw2ul5/y1AoGAIK6qDVHaX5AllhBvJV49Tjt+9yMK+Tcs9jf0M6ONkny6IOsnMblb+suBuXNPUnygqJV7fkiTvPgF0DyfHO55OX8jAorI0Hoq5K5hDUWqsRlxklwSSbke/7q23TPmdGPaCIlW2cOo9IKe6OhhixCNhnn5U8TMDzzWVcDRlZ0ZfW0CgYA+Hh5zGCcpd0e+pB/GUf+zYuymMnBdyX8mU2CUA3D0HFkB9nxqLWy2VJq4/U4Xa0jmcS/72Pe3QJST3QOI8ZXyDMghhQRlYm5QY22N9yHmjafQute33BJ+VkkuWtrJh9cEhXUruusDuuvFB5OVwS8xi/1FL9nDoIDIR3TKvFBs8A==",
    "pubKey": "CAASpgIwggEiMA0GCSqGSIb3DQEBAQUAA4IBDwAwggEKAoIBAQD5ZH+GVM+hqrABL/QkGmuXUbwXqjeEpi/HkUb2452m1hKXiUUvWLKrUuGhg/kYBYsiqz32p6JpyaUrSr/QGAB8y8UrKxqsIhVqHcGlttxTfD8i4sDju8mHlPu/3q5w/ZPABwMiyyL8G+y5cIsiKGCF480VwiDgYodirTXrmRb0yGAMZf0OBr6pcaCqCuqPyVJPxC0Kk8u1WUXfnkxQ0bfQITf0KC+fIBKvOIaWMzSWDSaOFcwQI5a2u8x0Wun83usiIx/OqUMEJifxoY7kEtMkvYKY84PoZA52yb9MIAsY+kv7tnXUAN6x7I9nklGYjgPcAu4PBkKe9Q5CDyTP1pqfAgMBAAE="
  })

  const peerPublisher = new PeerInfo(idPublisher)
  peerPublisher.multiaddr.add(multiaddr('/ip4/192.168.230.131/tcp/10333/ipfs/QmTvzVUurS91zTQ3y7GyTk3w6VzKPq8bF9z5oKVmiK9czf'))
  
  ps.connect(peerPublisher)
  
  setInterval(() => {
    console.log(Object.keys(ps.getPeerSet()))
    if (Object.keys(ps.getPeerSet()).length > 0) console.log(ps.getPeerSet()['QmTvzVUurS91zTQ3y7GyTk3w6VzKPq8bF9z5oKVmiK9czf'].topics)
    // if (Object.keys(ps.getPeerSet()).length > 0) console.log(ps.getPeerSet()['QmUpogGXDSvrdVww2wsynANFZ4MMNSKpHksuSyYUQYZjYA'].topics)
    // if (Object.keys(ps.getPeerSet()).length > 0) console.log(ps.getPeerSet()['Qma3GsJmB47xYuyahPZPSadh1avvxfyYQwk8R3UnFrQ6aP'].topics)
  }, 3000)
}

series([
  bootNode,
  setUpPS
], listen)
