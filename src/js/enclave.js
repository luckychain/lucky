/**
 * A simpler API to talk to the secure worker which abstracts away
 * all the messaging.
 */

var uuid = require('node-uuid')
var SecureWorker = require('./secureworker')

function randomId() {
  return uuid.v4()
}

function serialize(data) {
  // Using == on purpose.
  if (data == null) {
    return null
  }

  return JSON.stringify(data)
}

function deserialize(string) {
  // Using == on purpose.
  if (string == null) {
    return null
  }

  return JSON.parse(string)
}

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

module.exports = function enclaveConstructor() {
  var secureWorker = new SecureWorker('lucky-chain.js')

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