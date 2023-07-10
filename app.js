var express = require('express');
var path = require('path');
var cookieParser = require('cookie-parser');
var logger = require('morgan');
var cors = require('cors')

var indexRouter = require('./routes/index');
var usersRouter = require('./routes/users');
var sitesRouter = require('./routes/sites')
var tracesRouter = require('./routes/traces')
var endpointCostRouter = require('./routes/endpointcost')
var costMapsRouter = require('./routes/costmaps')

var app = express();

app.use(cors())
app.use(logger('dev'));
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(cookieParser());
// app.use(express.static(path.join(__dirname, 'public')));

app.use('/', indexRouter);
app.use('/users', usersRouter);
app.use('/sites', sitesRouter)
app.use('/traces', tracesRouter)
app.use('/endpointcost', endpointCostRouter)
app.use('/costmaps', costMapsRouter)

module.exports = app;
