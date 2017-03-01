self.dagPB = require('ipld-dag-pb')
self.multihashing = require('multihashing-async')

var serialization = require('./serialization')

self.serialize = serialization.serialize
self.deserialize = serialization.deserialize
