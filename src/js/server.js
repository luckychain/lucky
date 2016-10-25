var bodyParser = require('body-parser')
var cors = require('cors')
var express = require('express')
var path = require('path')

var node = express()
node.use(cors())
node.set('views', path.join(__dirname, '../ejs'))
node.set('view engine', 'ejs')
node.use(express.static(path.join(__dirname, '../../public')))
node.use(bodyParser.json())
node.use(bodyParser.urlencoded({ extended: true }))

var blockchain = require('./blockchain.js')
blockchain(node)

module.exports = node
