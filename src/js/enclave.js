/**
 * A simpler API to talk to the secure worker which abstracts away
 * all the messaging.
 */

var uuid = require('node-uuid')
var multihashing = require('multihashing-async')
var SecureWorker = require('./secureworker')
var serialization = require('./serialization')
var fiberUtils = require('./fiber-utils')

function randomId() {
  return uuid.v4()
}

module.exports = function enclaveConstructor() {
  var secureWorker = new SecureWorker('lucky-chain.js')

  function afterSleep(callback) {
    var requestId = randomId()

    secureWorker.onMessage(function messageHandler(message) {
      if (message.type !== 'teeProofOfLuckResumeFromSleepResult' || message.requestId !== requestId) return;
      secureWorker.removeOnMessage(messageHandler);

      var error = serialization.deserialize(message.error)
      var report = serialization.deserialize(message.result)

      if (error) {
        callback(error)
        return
      }

      try {
        var quote = SecureWorker.getQuote(report)
        var attestation = SecureWorker.getRemoteAttestation(quote)
      }
      catch (error) {
        callback(error)
      }

      callback(null, {Quote: quote, Attestation: attestation})
    });

    secureWorker.postMessage({
      type: 'teeProofOfLuckResumeFromSleep',
      requestId: requestId,
      args: []
    })
  }

  var api = {
    teeProofOfLuckRound: function teeProofOfLuckRound(blockPayload, callback) {
      var requestId = randomId()

      secureWorker.onMessage(function messageHandler(message) {
        if (message.type !== 'teeProofOfLuckRoundResult' || message.requestId !== requestId) return;
        secureWorker.removeOnMessage(messageHandler);

        callback(serialization.deserialize(message.error), serialization.deserialize(message.result))
      });

      secureWorker.postMessage({
        type: 'teeProofOfLuckRound',
        requestId: requestId,
        args: [blockPayload].map(serialization.serialize)
      })
    },

    teeProofOfLuckMine: function teeProofOfLuckMine(payload, previousBlock, previousBlockPayload, callback) {
      var requestId = randomId()

      secureWorker.onMessage(function messageHandler(message) {
        if (message.type !== 'teeProofOfLuckMineResult' || message.requestId !== requestId) return;
        secureWorker.removeOnMessage(messageHandler);

        var error = serialization.deserialize(message.error)
        if (error) {
          return callback(error)
        }

        setTimeout(function () {
          afterSleep(callback)
        }, serialization.deserialize(message.result) * 1000) // message.result is in seconds.
      });

      secureWorker.postMessage({
        type: 'teeProofOfLuckMine',
        requestId: requestId,
        args: [payload, previousBlock, previousBlockPayload].map(serialization.serialize)
      })
    },

    teeProofOfLuckNonce: function teeProofOfLuckNonce(quote) {
      var nonceBuffer = SecureWorker.getQuoteData(quote)
      var nonceView = new DataView(nonceBuffer)

      if (nonceView.getUint8(0) !== 1) {
        throw new Error("Invalid nonce version: " + nonceView.getUint8(0))
      }

      var luck = nonceView.getFloat64(1, true)
      var hashByteLength = nonceView.getUint8(9)
      var hash = nonceBuffer.slice(10, 10 + hashByteLength)

      return {
        luck: luck,
        hash: multihashing.multihash.toB58String(new Buffer(hash))
      }
    }
  }

  api.teeProofOfLuckRoundSync = fiberUtils.wrap(api.teeProofOfLuckRound)
  api.teeProofOfLuckMineSync = fiberUtils.wrap(api.teeProofOfLuckMine)

  return api
}