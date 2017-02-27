// This code runs inside an SGX enclave.

SecureWorker.importScripts('ipld-dag.js')

var ROUND_TIME = 10 // seconds

function arraysEqual(array1, array2) {
    if (array1.byteLength !== array2.byteLength) {
      return false
    }

    var a1 = new Uint8Array(array1)
    var a2 = new Uint8Array(array2)

    for (var i = 0; i !== a1.length; i++) {
      if (a1[i] !== a2[i]) return false
    }

    return true
}

function log(message) {
  if (typeof console !== 'undefined') {
    console.log(message)
  }
}

function serialize(data) {
  // Using == on purpose.
  if (data == null) {
    return null
  }

  if (data instanceof Error) {
    data = {
      $type: 'error',
      msg: '' + data,
      stack: data.stack
    }
  }

  return JSON.stringify(data)
}

function deserialize(string) {
  // Using == on purpose.
  if (string == null) {
    return null
  }

  var data = JSON.parse(string)

  if (data.$type === 'error') {
    var newData = new Error(data.msg)
    newData.stack = data.stack
    data = newData
  }

  return data
}

var timeSourceNonce = null

/**
 * Returns number of seconds relative to a reference point, as a number.
 */
function teeGetTrustedTime() {
  var trustedTime = SecureWorker.getTrustedTime()

  if (timeSourceNonce === null) {
    timeSourceNonce = trustedTime.timeSourceNonce
  }

  if (!arraysEqual(timeSourceNonce, trustedTime.timeSourceNonce)) {
    throw new Error("timeSourceNonce changed")
  }

  var currentTimeView = new DataView(trustedTime.currentTime)

  return currentTimeView.getUint32(0, true) + currentTimeView.getUint32(4, true) * Math.pow(2, 32)
}

var monotonicCounterId = null

// TODO: We should create all 256 monotonic counters and use them as one monotonic counter.
function teeIncrementMonotonicCounter() {
  if (monotonicCounterId === null) {
    var createdMonotonicCounter = SecureWorker.monotonicCounters.create()
    monotonicCounterId = createdMonotonicCounter.uuid
    return createdMonotonicCounter.value
  }
  else {
    return SecureWorker.monotonicCounters.increment(monotonicCounterId)
  }
}

function teeReadMonotonicCounter() {
  if (monotonicCounterId === null) {
    throw new Error("Invalid state, monotonicCounterId")
  }

  return SecureWorker.monotonicCounters.read(monotonicCounterId)
}

/**
 * Returns a random value from [0, 1) interval.
 * Based on: http://stackoverflow.com/a/13694869/252025
 */
function teeGetRandom() {
  var array = new Uint32Array(2)
  crypto.getRandomValues(array)

  // Keep all 32 bits of the the first, top 20 of the second for 52 random bits.
  var mantissa = (array[0] * Math.pow(2, 20)) + (array[1] >>> 12)

  // Shift all 52 bits to the right of the decimal point.
  return mantissa * Math.pow(2, -52)
}

function teeReport(nonce) {
  return SecureWorker.getReport(nonce)
}

var counter = teeIncrementMonotonicCounter()
var roundBlockPayload = null
var roundTime = null
var sleepCallback = null

/**
 * Returns an IPFS hash of a given object, returning a buffer.
 */
function ipfsHashBuffer(object) {
  return new Promise(function (resolve, reject) {
    dagPB.DAGNode.create(object.Data, object.Links, 'sha2-256', function (error, node) {
      if (error) {
        reject(error)
      }
      else {
        resolve(node.multihash)
      }
    })
  })
}

/**
 * Returns an IPFS hash of a given object, returning it encoded as a string.
 */
function ipfsHash(object) {
  return ipfsHashBuffer(object).then(function (multihashBuffer) {
    return multihashing.multihash.toB58String(multihashBuffer)
  })
}

function f(l) {
  return (1 - l) * ROUND_TIME
}

function verifyPayload(payload) {
  // Using == on purpose.
  if (payload == null) {
    return false
  }

  // TODO: Implement the rest of checks. For example, structure, lucky number limits.

  return true
}

function verifyBlock(block) {
  // Using == on purpose.
  if (block == null) {
    return false
  }

  // TODO: Implement the rest of checks.

  return true
}

/**
 * This function is a TEE method that sets the state of roundBlockPayload
 * and roundTime. The trusted time service teeGetTrustedTime() represents
 * a standard method provided as part of the TEE and is used as
 * verification for ROUND_TIME when mining a new block.
 */
function teeProofOfLuckRound(blockPayload) {
  // TODO: We should allow round to be committed in any state, resetting all other state to the new state.

  if (sleepCallback !== null) {
    throw new Error("Invalid state, sleepCallback")
  }

  if (roundBlockPayload !== null || roundTime !== null) {
    throw new Error("Invalid state, roundBlockPayload or roundTime")
  }

  if (!verifyPayload(blockPayload)) {
    throw new Error("Invalid blockPayload")
  }

  roundBlockPayload = blockPayload
  roundTime = teeGetTrustedTime()
}

/**
 * This function is a TEE method that uses the given new payload and
 * previous block and starts by checking the required ROUND_TIME has
 * elapsed before proceeding to generate a new luck value, using it
 * to compute an f(l) which determines the amount of time the TEE will
 * sleep. Upon return from sleeping f(l) duration, the function returns
 * a teeReport() that includes the luck value and payload hash.
 * Sleeping is implemented with help of another function,
 * teeProofOfLuckResumeFromSleep.
 */
function teeProofOfLuckMine(payload, previousBlock, previousBlockPayload, callback) {
  if (sleepCallback !== null) {
    throw new Error("Invalid state, sleepCallback")
  }

  if (roundBlockPayload === null || roundTime === null) {
    throw new Error("Invalid state, roundBlockPayload or roundTime")
  }

  if (!verifyPayload(payload)) {
    throw new Error("Invalid payload")
  }

  if (!verifyBlock(previousBlock)) {
    throw new Error("Invalid previousBlock")
  }

  if (!verifyPayload(previousBlockPayload)) {
    throw new Error("Invalid previousBlockPayload")
  }

  ipfsHash(previousBlock).then(function (previousBlockIpfsHash) {
    // The last link points to the parent block.
    var payloadParentLink = payload.Links[payload.Links.length - 1]
    if (payloadParentLink.Name !== "parent" || payloadParentLink.Hash !== previousBlockIpfsHash) {
      throw new Error("payload.parent != hash(previousBlock)")
    }

    return ipfsHash(previousBlockPayload)
  }).then(function (previousBlockPayloadIpfsHash) {
    var previousBlockPayloadLink = previousBlock.Links[0]
    if (previousBlockPayloadLink.Name !== "payload" || previousBlockPayloadLink.Hash !== previousBlockPayloadIpfsHash) {
      throw new Error("previousBlock.payload != hash(previousBlockPayload)")
    }

    // The last link points to the parent block.
    var roundBlockPayloadParentLink = roundBlockPayload.Links[roundBlockPayload.Links.length - 1]
    var previousBlockPayloadParentLink = previousBlockPayload.Links[previousBlockPayload.Links.length - 1]
    if (previousBlockPayloadParentLink.Name !== "parent" || roundBlockPayloadParentLink.Name !== "parent" || previousBlockPayloadParentLink.Hash !== roundBlockPayloadParentLink.Hash) {
      throw new Error("previousBlockPayload.parent != roundBlockPayload.parent")
    }

    var now = teeGetTrustedTime()

    if (now < roundTime + ROUND_TIME) {
      throw new Error("now < roundTime + ROUND_TIME")
    }

    roundBlockPayload = null
    roundTime = null

    return ipfsHashBuffer(payload)
  }).then(function (payloadIpfsHashBuffer) {
    var payloadHash = new Uint8Array(payloadIpfsHashBuffer)
    var l = teeGetRandom()

    var nonceBuffer = new ArrayBuffer(64)
    var nonceArray = new Uint8Array(nonceBuffer)
    var nonceView = new DataView(nonceBuffer)

    // Version.
    nonceView.setUint8(0, 1)
    // Luck.
    nonceView.setFloat64(1, l, true)
    // Size of payloadHash.
    nonceView.setUint8(9, payloadHash.byteLength)
    // payloadHash.
    nonceArray.set(payloadHash, 10)

    sleepCallback = function () {
      var newCounter = teeReadMonotonicCounter()
      if (counter !== newCounter) {
        throw new Error("counter !== newCounter")
      }

      return teeReport(nonceBuffer)
    }

    // Returns the time to sleep, in seconds.
    callback(null, f(l))
  }).catch(function (error) {
    callback(error)
  })
}

/**
 * A helper function to implement sleeping by returning to outside
 * of the enclave an then returning back in after sleeping time passed.
 */
function teeProofOfLuckResumeFromSleep() {
  // TODO: Verify that really sleeping time passed.

  if (sleepCallback === null) {
    throw new Error("Invalid state, sleepCallback")
  }

  if (roundBlockPayload !== null || roundTime !== null) {
    throw new Error("Invalid state, roundBlockPayload or roundTime")
  }

  var callback = sleepCallback
  sleepCallback = null

  return callback()
}

SecureWorker.onMessage(function (message) {
  if (!message || !message.requestId || !message.type) {
    log("Invalid message in onMessage")
    return
  }

  try {
    if (message.type === 'teeProofOfLuckRound') {
      SecureWorker.postMessage({
        type: message.type + 'Result',
        requestId: message.requestId,
        result: serialize(teeProofOfLuckRound.apply(null, (message.args || []).map(deserialize)))
      })
    }
    else if (message.type === 'teeProofOfLuckMine') {
      teeProofOfLuckMine.apply(null, (message.args || []).map(deserialize).concat(function (error, sleepTime) {
        if (error) {
          SecureWorker.postMessage({
            type: message.type + 'Result',
            requestId: message.requestId,
            error: serialize(error)
          })
        }
        else {
          SecureWorker.postMessage({
            type: message.type + 'Result',
            requestId: message.requestId,
            result: serialize(sleepTime)
          })
        }
      }))
    }
    else if (message.type === 'teeProofOfLuckResumeFromSleep') {
      SecureWorker.postMessage({
        type: message.type + 'Result',
        requestId: message.requestId,
        result: serialize(teeProofOfLuckResumeFromSleep.apply(null, (message.args || []).map(deserialize)))
      })
    }
    else {
      log("Unknown message type in onMessage: " + message.type)
    }
  }
  catch (error) {
    SecureWorker.postMessage({
      type: message.type + 'Result',
      requestId: message.requestId,
      error: serialize(error)
    })
  }
})