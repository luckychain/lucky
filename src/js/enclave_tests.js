var stringify = require('json-stable-stringify')
var dagPB = require('ipld-dag-pb')
var enclave = require('./enclave')()
var SecureWorker = require('./secureworker')
var fiberUtils = require('./fiber-utils')

var teeProofOfLuckRound = fiberUtils.wrap(enclave.teeProofOfLuckRound)
var teeProofOfLuckMine = fiberUtils.wrap(enclave.teeProofOfLuckMine)
var teeProofOfLuckNonce = enclave.teeProofOfLuckNonce

var DAGNodeCreate = fiberUtils.wrap(dagPB.DAGNode.create)

// They should share a common parent.
var PREVIOUS_BLOCK_PAYLOAD_1 = {
  Data: "",
  Links: [{
    Name: "transaction",
    Hash: "QmYq9pkvHvvMRJAtxKk9i6QAFmYy9mNcht4BCHPAyTeG7V",
    Size: 221
  }, {
    Name: "transaction",
    Hash: "QmQmubQoc1dix3euA5ELQjMAQfuYLBHa4LGCK7uXXanFNg",
    Size: 221
  }, {
    Name: "parent",
    Hash: "QmVfcs156wrBYPqV2D4J5C3GLiEXgUsYbbTrmb9onRNwQT",
    Size: 223
  }]
}
var PREVIOUS_BLOCK_PAYLOAD_2 = {
  Data: "",
  Links: [{
    Name: "transaction",
    Hash: "QmZNKKP4jnaiuRFeRL392TrxVg49GUa2NyogA8pogwf43S",
    Size: 223
  }, {
    Name: "transaction",
    Hash: "QmQxWsazUayEknpaJCkPh2hKUEP4bjU2zjnuSBpujtVNWV",
    Size: 221
  }, {
    Name: "parent",
    Hash: "QmVfcs156wrBYPqV2D4J5C3GLiEXgUsYbbTrmb9onRNwQT",
    Size: 223
  }]
}

var PREVIOUS_BLOCK = {
  Data: stringify({
    Luck: 0.4,
    Proof: "<TEE signature>"
  }),
  Links: [{
    Name: "payload",
    Hash: "Qma11Npj9XqsCJK5DvQLjTXLKcwUCwJqUSmTchpnV7f8SM", // PREVIOUS_BLOCK_PAYLOAD_2
    Size: 819
  }]
}

var NEW_PAYLOAD = {
  Data: "",
  Links: [{
    Name: "transaction",
    Hash: "QmTgj6tZNaxAt1ZAYDQ3AUeVn96Mc27jYXtBna47tWEw4a",
    Size: 221
  }, {
    Name: "transaction",
    Hash: "QmdnUBHkBgVRLE5CsG6EEYBxznhqeBJjGXfRpMzD7TJZrB",
    Size: 221
  }, {
    Name: "parent",
    Hash: "QmRmc5oe4fvphRtvA9q2W5BXDGnZYaHaYEA6TenfHcTDm4", // PREVIOUS_BLOCK
    Size: 909
  }]
}

fiberUtils.in(function () {
  console.log("Starting a round")

  teeProofOfLuckRound(PREVIOUS_BLOCK_PAYLOAD_1)

  // It should throw an error if it is called too soon.
  var errorThrown = false
  try {
    teeProofOfLuckMine(NEW_PAYLOAD, PREVIOUS_BLOCK, PREVIOUS_BLOCK_PAYLOAD_2)
  }
  catch (error) {
    errorThrown = true
  }
  if (!errorThrown) throw new Error("Error has not been thrown")

  console.log("Waiting 10 seconds")
  fiberUtils.sleep(10000)

  console.log("Mining")
  var proof = teeProofOfLuckMine(NEW_PAYLOAD, PREVIOUS_BLOCK, PREVIOUS_BLOCK_PAYLOAD_2)

  if (!SecureWorker.validateRemoteAttestation(proof.Quote, proof.Attestation)) throw new Error("Remote attestation is not valid")

  var nonce = teeProofOfLuckNonce(proof.Quote)

  var node = DAGNodeCreate(NEW_PAYLOAD.Data, NEW_PAYLOAD.Links, 'sha2-256')

  if (nonce.luck < 0.0 || nonce.luck >= 1.0) throw new Error("Invalid luck: " + nonce.luck)
  if (nonce.hash !== node.toJSON().multihash) throw new Error("Invalid nonce hash: " + nonce.hash)

  console.log("Success", proof, nonce)
})()
