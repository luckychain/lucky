var Fiber = require('fibers')
var Future = require('fibers/future')

module.exports = {
  wrap: function wrap(f, scope) {
    return function () {
      return Future.wrap(f).apply(scope, arguments).wait()
    }
  },
  in: function inFiber(f, scope) {
    return function () {
      var args = Array.from(arguments)
      if (Fiber.current) {
        f.apply(scope, args)
      }
      else {
        new Fiber(function () {
          f.apply(scope, args)
        }).run()
      }
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