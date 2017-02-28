/**
 * Configures the mock version of the secure worker.
 */

var crypto = require('crypto')
var fs = require('fs')
var path = require('path')
var uuid = require('node-uuid')
var Uint64LE = require('int64-buffer').Uint64LE
var SecureWorker = require('secureworker')

var monotonicCounters = {}
var monotonicCountersCount = 0

SecureWorker._resolveContentKey = function _resolveContentKey(contentKey) {
  return fs.readFileSync(path.join(__dirname, '..', '..', 'enclave', contentKey), 'utf8')
}

SecureWorker._createMonotonicCounter = function _createMonotonicCounter(context) {
  if (monotonicCountersCount >= 256) throw new context.Error("Monotonic counter limit reached.")

  monotonicCountersCount++
  var counterId = uuid.v4({}, new context.ArrayBuffer())
  var counterIdStr = uuid.unparse(counterId)
  monotonicCounters[counterIdStr] = 0
  return new context.Object({
    uuid: counterId,
    value: monotonicCounters[counterIdStr]
  })
}

SecureWorker._destroyMonotonicCounter = function _destroyMonotonicCounter(context, counterId) {
  var counterIdStr = uuid.unparse(counterId)
  if (!monotonicCounters.hasOwnProperty(counterIdStr)) throw new context.Error("Unknown monotonic counter.")

  delete monotonicCounters[counterIdStr]
  monotonicCountersCount--
}

SecureWorker._readMonotonicCounter = function _readMonotonicCounter(context, counterId) {
  var counterIdStr = uuid.unparse(counterId)
  if (!monotonicCounters.hasOwnProperty(counterIdStr)) throw new context.Error("Unknown monotonic counter.")

  return monotonicCounters[counterIdStr]
}

SecureWorker._incrementMonotonicCounter = function _incrementMonotonicCounter(context, counterId) {
  var counterIdStr = uuid.unparse(counterId)
  if (!monotonicCounters.hasOwnProperty(counterIdStr)) throw new context.Error("Unknown monotonic counter.")

  return ++monotonicCounters[counterIdStr]
}

var timeSourceNonce = crypto.randomBytes(32)
timeSourceNonce = new Uint8Array(timeSourceNonce.buffer.slice(timeSourceNonce.byteOffset, timeSourceNonce.byteOffset + timeSourceNonce.byteLength))

SecureWorker._getTrustedTime = function _getTrustedTime(context) {
  var currentTime = new Uint8Array(new Uint64LE(Math.floor(new Date() / 1000)).toArrayBuffer())

  // Copying to ArrayBuffers from context.
  var contextCurrentTime = new context.ArrayBuffer(currentTime.byteLength)
  var contextTimeSourceNone = new context.ArrayBuffer(timeSourceNonce.byteLength)
  new context.Uint8Array(contextCurrentTime).set(currentTime)
  new context.Uint8Array(contextTimeSourceNone).set(timeSourceNonce)

  return new context.Object({
    currentTime: contextCurrentTime,
    timeSourceNonce: contextTimeSourceNone
  })
}

SecureWorker._getReport = function _getReport(context, reportData) {
  // Using == on purpose.
  if (!((reportData == null) || (reportData instanceof context.ArrayBuffer && reportData.byteLength === 64))) throw new context.Error("Invalid report data.")

  // report = sgx_report_body_t + sgx_key_id_t (32 B) + sgx_mac_t (16 B)
  // sgx_report_body_t = sgx_cpu_svn_t (16 B) + sgx_misc_select_t (4 B) + uint8_t[28] + sgx_attributes_t (16 B) + sgx_measurement_t (32 B) + uint8_t[32] + sgx_measurement_t (32 B) + uint8_t[96] + sgx_prod_id_t (2 B) + sgx_isv_svn_t (2 B) + uint8_t[60] + sgx_report_data_t (64 B)
  // length of the report in bytes: 320 B + 64 B (report data) + 48 B (key + mac)

  var report = new context.ArrayBuffer(320 + 64 + 48)

  if (reportData) {
    var view = new context.Uint8Array(report)
    view.set(new context.Uint8Array(reportData), 320)
  }

  return report
}

module.exports = SecureWorker
