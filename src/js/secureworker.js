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
  return fs.readFileSync(path.join(__dirname, contentKey), 'utf8')
}

SecureWorker._createMonotonicCounter = function _createMonotonicCounter() {
  if (monotonicCountersCount >= 256) throw new Error("Monotonic counter limit reached.")

  monotonicCountersCount++
  var counterId = uuid.v4({}, new ArrayBuffer())
  var counterIdStr = uuid.unparse(counterId)
  monotonicCounters[counterIdStr] = 0
  return {
    uuid: counterId,
    value: monotonicCounters[counterIdStr]
  }
}

SecureWorker._destroyMonotonicCounter = function _destroyMonotonicCounter(counterId) {
  var counterIdStr = uuid.unparse(counterId)
  if (!monotonicCounters.hasOwnProperty(counterIdStr)) throw new Error("Unknown monotonic counter.")

  delete monotonicCounters[counterIdStr]
  monotonicCountersCount--
}

SecureWorker._readMonotonicCounter = function _readMonotonicCounter(counterId) {
  var counterIdStr = uuid.unparse(counterId)
  if (!monotonicCounters.hasOwnProperty(counterIdStr)) throw new Error("Unknown monotonic counter.")

  return monotonicCounters[counterIdStr]
}

SecureWorker._incrementMonotonicCounter = function _incrementMonotonicCounter(counterId) {
  var counterIdStr = uuid.unparse(counterId)
  if (!monotonicCounters.hasOwnProperty(counterIdStr)) throw new Error("Unknown monotonic counter.")

  return ++monotonicCounters[counterIdStr]
}

var timeSourceNonce = crypto.randomBytes(32)

SecureWorker._getTrustedTime = function _getTrustedTime() {
  return {
    currentTime: new Uint64LE(Math.floor(new Date() / 1000)).toArrayBuffer(),
    // We make a copy and convert to ArrayBuffer.
    timeSourceNonce: timeSourceNonce.buffer.slice(timeSourceNonce.byteOffset, timeSourceNonce.byteOffset + timeSourceNonce.byteLength)
  }
}

SecureWorker._getReport = function _getReport(reportData) {
  if (!((reportData === null) || (reportData instanceof ArrayBuffer && reportData.byteLength === 64))) throw new Error("Invalid report data.")

  // report = sgx_report_body_t + sgx_key_id_t (32 B) + sgx_mac_t (16 B)
  // sgx_report_body_t = sgx_cpu_svn_t (16 B) + sgx_misc_select_t (4 B) + uint8_t[28] + sgx_attributes_t (16 B) + sgx_measurement_t (32 B) + uint8_t[32] + sgx_measurement_t (32 B) + uint8_t[96] + sgx_prod_id_t (2 B) + sgx_isv_svn_t (2 B) + uint8_t[60] + sgx_report_data_t (64 B)
  // length of the report in bytes: 320 B + 64 B (report data) + 48 B (key + mac)

  var report = new ArrayBuffer(320 + 64 + 48)

  if (reportData) {
    var view = new Uint8Array(report)
    view.set(reportData, 320)
  }

  return report
}

module.exports = SecureWorker
