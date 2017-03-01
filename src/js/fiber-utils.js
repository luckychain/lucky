var Future = require('fibers/future')

module.exports = {
  wrap: function wrap(f, scope) {
    return function () {
      return Future.wrap(f).apply(scope, arguments).wait()
    }
  },
  sleep: function sleep(ms) {
    var future = new Future()
    setTimeout(function () {
      future.return()
    }, ms)
    future.wait()
  }
}