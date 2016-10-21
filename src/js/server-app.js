
/********************************* MODULES ***********************************/

var bodyParser = require('body-parser');
var cors = require('cors');
var express = require('express');
var path = require('path');

var app = express();
var core = require('./core-app.js');

/******************************** SETUP PORT *********************************/

var port = (process.env.PORT || '3000');
app.set('port', port);
app.use(cors());

/**************************** SETUP DIRECTORIES ******************************/

app.set('views', path.join(__dirname, '../ejs'));
app.set('view engine', 'ejs');
app.use(express.static(path.join(__dirname, '../../public')));

/***************************** SETUP MIDDLEWARE ******************************/

app.use(bodyParser.json());
app.use(bodyParser.urlencoded({ extended: true }));

/*************************** CORE INITIALIZATION *****************************/

core({ app: app });

/****************************** ERROR HANDLERS *******************************/

app.use(function(req, res, next) {
  var err = new Error('Not Found');
  err.status = 404;
  next(err);
});

if (app.get('env') === 'development') {
  app.use(function(err, req, res, next) {
    res.status(err.status || 500);
    res.render('error', { message: err.message, error: err });
  });
}

app.use(function(err, req, res, next) {
  res.status(err.status || 500);
  res.render('error', { message: err.message, error: {} });
});

/*****************************************************************************/

module.exports = app;
