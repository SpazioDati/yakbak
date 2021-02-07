// Copyright 2016 Yahoo Inc.
// Licensed under the terms of the MIT license. Please see LICENSE file in the project root for terms.

var Promise = require('bluebird');
var buffer = require('./buffer');
var path = require('path');
var ejs = require('ejs');
var fs = require('fs');
var debug = require('debug')('yakbak:record');
var mkdirp = require('mkdirp');

/**
 * Read and pre-compile the tape template.
 * @type {Function}
 * @private
 */

var render = ejs.compile(fs.readFileSync(path.resolve(__dirname, '../src/tape.ejs'), 'utf8'));

/**
 * Record the http interaction between `req` and `res` to disk.
 * The format is a vanilla node module that can be used as
 * an http.Server handler.
 * @param {http.ClientRequest} req
 * @param {Array.<Buffer>} request body
 * @param {http.IncomingMessage} res
 * @param {String} filename
 * @param {Boolean} is_verbose
 * @param {String} namespace
 * @returns {Promise.<String>}
 */

module.exports = function (req, req_body, res, filename, is_verbose, namespace) {
  return buffer(res).then(function (body) {
    return render({ req: req, req_body: req_body, res: res, body: body, is_verbose: is_verbose });
  }).then(function (data) {
    return write(filename, data, namespace);
  }).then(function () {
    return filename;
  });
};

/**
 * Write `data` to `filename`. Seems overkill to "promisify" this.
 * @param {String} filename
 * @param {String} data
 * @returns {Promise}
 */

function write(filename, data, namespace) {
  return Promise.fromCallback(function (done) {
    var filenameDirectory = path.dirname(filename);
    if (!fs.existsSync(filenameDirectory)) {
      debug('Created directory', filenameDirectory);
      mkdirp.sync(filenameDirectory);
    }

    debug('write', filename);
    fs.writeFile(filename, data, done);
  });
}
