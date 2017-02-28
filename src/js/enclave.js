/**
 * A simpler API to talk to the secure worker which abstracts away
 * all the messaging.
 */

var uuid = require('node-uuid')
var bs58 = require('bs58')
var SecureWorker = require('./secureworker')

function randomId() {
  return uuid.v4()
}

function serialize(data) {
  // Using == on purpose.
  if (data == null) {
    return null
  }

  if (data instanceof Error) {
    data = {
      $type: 'Error',
      msg: '' + data,
      stack: data.stack
    }
  }
  else if (data instanceof ArrayBuffer) {
    data = {
      $type: 'ArrayBuffer',
      // It should be bs58.encode(new Buffer(data)), but it does not work in mock implementation,
      // because Buffer comes from outside of vm, while ArrayBuffer from inside. But it seems
      // converting to Uint8Array first works.
      data: bs58.encode(new Uint8Array(data))
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

  if (data.$type === 'Error') {
    var newData = new Error(data.msg)
    newData.stack = data.stack
    data = newData
  }
  else if (data.$type === 'ArrayBuffer') {
    data = new Uint8Array(bs58.decode(data.data)).buffer
  }

  return data
}

module.exports = function enclaveConstructor() {
  var secureWorker = new SecureWorker('lucky-chain.js')

  function afterSleep(callback) {
    var requestId = randomId()

    secureWorker.onMessage(function messageHandler(message) {
      if (message.type !== 'teeProofOfLuckResumeFromSleepResult' || message.requestId !== requestId) return;
      secureWorker.removeOnMessage(messageHandler);

      callback(deserialize(message.error), deserialize(message.result))
    });

    secureWorker.postMessage({
      type: 'teeProofOfLuckResumeFromSleep',
      requestId: requestId,
      args: []
    })
  }

  return {
    teeProofOfLuckRound: function teeProofOfLuckRound(blockPayload, callback) {
      var requestId = randomId()

      secureWorker.onMessage(function messageHandler(message) {
        if (message.type !== 'teeProofOfLuckRoundResult' || message.requestId !== requestId) return;
        secureWorker.removeOnMessage(messageHandler);

        callback(deserialize(message.error), deserialize(message.result))
      });

      secureWorker.postMessage({
        type: 'teeProofOfLuckRound',
        requestId: requestId,
        args: [blockPayload].map(serialize)
      })
    },

    teeProofOfLuckMine: function teeProofOfLuckMine(payload, previousBlock, previousBlockPayload, callback) {
      var requestId = randomId()

      secureWorker.onMessage(function messageHandler(message) {
        if (message.type !== 'teeProofOfLuckMineResult' || message.requestId !== requestId) return;
        secureWorker.removeOnMessage(messageHandler);

        var error = deserialize(message.error)
        if (error) {
          return callback(error)
        }

        setTimeout(function () {
          afterSleep(callback)
        }, deserialize(message.result) * 1000) // message.result is in seconds.
      });

      secureWorker.postMessage({
        type: 'teeProofOfLuckMine',
        requestId: requestId,
        args: [payload, previousBlock, previousBlockPayload].map(serialize)
      })
    }
  }
}