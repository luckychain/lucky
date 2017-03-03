/**
 * A simpler API to talk to the secure worker which abstracts away
 * all the messaging.
 */

var uuid = require('node-uuid')
var multihashing = require('multihashing-async')
var SecureWorker = require('./secureworker')
var serialization = require('./serialization')
var fiberUtils = require('./fiber-utils')
var Future = require('fibers/future')

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
        return
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

      var canceled = false
      var timeout = null

      var callbackCalled = false
      var wrappedCallback = function () {
        if (callbackCalled) {
          return
        }
        callbackCalled = true

        callback.apply(null, arguments)
      }

      secureWorker.onMessage(function messageHandler(message) {
        if (message.type !== 'teeProofOfLuckMineResult' || message.requestId !== requestId) return;
        secureWorker.removeOnMessage(messageHandler);

        if (canceled) {
          return
        }

        var error = serialization.deserialize(message.error)
        if (error) {
          return wrappedCallback(error)
        }

        timeout = setTimeout(function () {
          if (canceled) {
            return
          }

          afterSleep(wrappedCallback)
        }, serialization.deserialize(message.result) * 1000) // message.result is in seconds.
      });

      secureWorker.postMessage({
        type: 'teeProofOfLuckMine',
        requestId: requestId,
        args: [payload, previousBlock, previousBlockPayload].map(serialization.serialize)
      })

      return function cancel() {
        canceled = true
        if (timeout) {
          clearTimeout(timeout)
          timeout = null
        }

        setImmediate(wrappedCallback)
      }
    },

    teeProofOfLuckNonce: function teeProofOfLuckNonce(quote) {
      var nonceBuffer = SecureWorker.getQuoteData(quote)
      var nonceView = new DataView(nonceBuffer)

      if (nonceView.getUint8(0) !== 1) {
        throw new Error(`Invalid nonce version: ${nonceView.getUint8(0)}`)
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

  // Not a traditional sync function. It returns a future and cancel function. You should wait on future,
  // but you can also cancel waiting (and mining, especially sleeping based on your lucky number) in parallel.
  api.teeProofOfLuckMineSync = function (payload, previousBlock, previousBlockPayload) {
    var future = new Future()
    var cancel = api.teeProofOfLuckMine(payload, previousBlock, previousBlockPayload, future.resolver())
    return {
      future: future,
      cancel: cancel
    }
  }

  return api
}