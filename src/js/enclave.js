/**
 * A simpler API to talk to the secure worker which abstracts away
 * all the messaging.
 */

var uuid = require('node-uuid')
var SecureWorker = require('./secureworker')

function randomId() {
  return uuid.v4()
}

function afterSleep(callback) {
  var requestId = randomId()

  secureWorker.onMessage(function messageHandler(message) {
    if (message.type !== 'teeProofOfLuckResumeFromSleepResult' || message.requestId !== requestId) return;
    secureWorker.removeOnMessage(messageHandler);

    callback(message.error, message.result)
  });

  secureWorker.postMessage({
    type: 'teeProofOfLuckResumeFromSleep',
    requestId: requestId,
    args: []
  })
}

module.exports = function enclaveConstructor() {
  var secureWorker = new SecureWorker('sgx.js')

  return {
    teeProofOfLuckRound: function teeProofOfLuckRound(blockPayload, callback) {
      var requestId = randomId()

      secureWorker.onMessage(function messageHandler(message) {
        if (message.type !== 'teeProofOfLuckRoundResult' || message.requestId !== requestId) return;
        secureWorker.removeOnMessage(messageHandler);

        callback(message.error, message.result)
      });

      secureWorker.postMessage({
        type: 'teeProofOfLuckRound',
        requestId: requestId,
        args: [blockPayload]
      })
    },

    teeProofOfLuckMine: function teeProofOfLuckMine(payload, previousBlock, previousBlockPayload, callback) {
      var requestId = randomId()

      secureWorker.onMessage(function messageHandler(message) {
        if (message.type !== 'teeProofOfLuckMineResult' || message.requestId !== requestId) return;
        secureWorker.removeOnMessage(messageHandler);

        if (message.error) {
          return callback(message.error)
        }

        setTimeout(function () {
          afterSleep(callback)
        }, message.result * 1000) // message.result is in seconds.
      });

      secureWorker.postMessage({
        type: 'teeProofOfLuckMine',
        requestId: requestId,
        args: [payload, previousBlock, previousBlockPayload]
      })
    }
  }
}