var Fiber = require('fibers')
var Future = require('fibers/future')
var fiberUtils = require('fiber-utils')

module.exports = new fiberUtils.FiberUtils(Fiber, Future)
