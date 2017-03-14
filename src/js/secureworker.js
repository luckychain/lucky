/**
 * Configures the mock version of the secure worker.
 */

var fs = require('fs')
var path = require('path')
var SecureWorker = require('secureworker')

SecureWorker._resolveContentKey = function _resolveContentKey(enclaveName, contentKey) {
  if (enclaveName !== 'luckychain.so') throw new Error("Unknown enclave")

  return fs.readFileSync(path.join(__dirname, '..', '..', 'enclave', contentKey), 'utf8')
}

module.exports = SecureWorker
