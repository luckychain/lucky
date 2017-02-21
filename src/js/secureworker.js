var fs = require('fs')
var path = require('path')
var uuid = require('uuid/v4')
var SecureWorker = require('secureworker')

// Configure mock version of the secure worker.

var monotonicCounters = {}
var monotonicCountersCount = 0

SecureWorker._resolveContentKey = function _resolveContentKey(contentKey) {
  return fs.readFileSync(path.join(__dirname, contentKey), 'utf8')
}

SecureWorker._createMonotonicCounter = function _createMonotonicCounter() {
  if (monotonicCountersCount >= 255) throw new Error("Monotonic counter limit reached.")

  monotonicCountersCount++
  var counterId = uuid()
  monotonicCounters[counterId] = 0
  return counterId
}

SecureWorker._destroyMonotonicCounter = function _destroyMonotonicCounter(counterId) {
  if (!monotonicCounters.hasOwnProperty(counterId)) throw new Error("Unknown monotonic counter.")

  delete monotonicCounters[counterId]
  monotonicCountersCount--
}

SecureWorker._readMonotonicCounter = function _readMonotonicCounter(counterId) {
  if (!monotonicCounters.hasOwnProperty(counterId)) throw new Error("Unknown monotonic counter.")

  return monotonicCounters[counterId]
}

SecureWorker._incrementMonotonicCounter = function _incrementMonotonicCounter(counterId) {
  if (!monotonicCounters.hasOwnProperty(counterId)) throw new Error("Unknown monotonic counter.")

  return ++monotonicCounters[counterId]
}

module.exports = SecureWorker
