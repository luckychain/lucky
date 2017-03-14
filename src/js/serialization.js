var bs58 = require('bs58')

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
      // It should be bs58.encode(new Buffer(data)), but it does not work in mock implementation
      // in node v6.3.0 (but has been fixed at least in v6.10.0) because Buffer comes from outside
      // of vm, while ArrayBuffer from inside. But it seems converting to Uint8Array first works.
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
    data = new Uint8Array(bs58.decode(data.data).values()).buffer
  }

  return data
}

module.exports = {
  serialize: serialize,
  deserialize: deserialize
}