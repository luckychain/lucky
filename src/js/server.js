var bodyParser = require('body-parser')
var cors = require('cors')
var express = require('express')
var path = require('path')

var app = express()
app.use(cors())
app.set('views', path.join(__dirname, '../ejs'))
app.set('view engine', 'ejs')
app.use(express.static(path.join(__dirname, '../../public')))
app.use(bodyParser.json())
app.use(bodyParser.urlencoded({ extended: true }))

var blockchain = require('./blockchain.js')
blockchain({ app: app })

app.use(function(req, res, next) {
  var err = new Error('Not Found')
  err.status = 404
  next(err)
})

app.use(function(err, req, res, next) {
  res.status(err.status || 500)
  res.render('error', { message: err.message, error: {} })
})

module.exports = app
