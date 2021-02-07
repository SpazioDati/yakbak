// Copyright 2016 Yahoo Inc.
// Licensed under the terms of the MIT license. Please see LICENSE file in the project root for terms.

var Promise = require('bluebird');
var hash = require('incoming-message-hash');
var assert = require('assert');
var mkdirp = require('mkdirp');
var path = require('path');
var buffer = require('./lib/buffer');
var proxy = require('./lib/proxy');
var record = require('./lib/record');
var curl = require('./lib/curl');
var debug = require('debug')('yakbak:server');
var fs = require('fs');


/**
 * Returns a new yakbak proxy middleware.
 * @param {String} host The hostname to proxy to
 * @param {Object} opts
 * @param {String} opts.dirname The tapes directory
 * @param {Boolean} opts.noRecord if true, requests will return a 404 error if the tape doesn't exist
 * @param {Boolean} opts.verbose if true, tapes comments will contain request and response body (might get large!)
 * @returns {Function}
 */

module.exports = function (host, opts) {
  assert(opts.dirname, 'You must provide opts.dirname');

  if (opts.verbose) {
      debug('Verbose mode active');
  }

  var defaultNamespace = '',
      currentNamespace = defaultNamespace,
      namespaceStats = {'': {errors: [], used: [], orphans: []}};

  return function (req, res) {
    mkdirp.sync(opts.dirname);

    return buffer(req).then(function (body) {

      var parsedUrl = new URL(req.url, `http://${req.headers.host}`);
      if (parsedUrl.pathname === '/yakbak/set-namespace/') {
        if (parsedUrl.searchParams.get('namespace') == null) {
          debug('Trying to set namespace with no namespace parameter', parsedUrl.searchParams);
          throw new NamespaceMethodError('No namespace given. Pass `?namespace=something` to set one.');
        }

        currentNamespace = parsedUrl.searchParams.get('namespace');
        namespaceStats[currentNamespace] = {errors: [], used: [], orphans: []};
        debug(`Set namespace to: ${currentNamespace}`);
        throw new NamespaceMethodSuccess(`Namespace set to: ${currentNamespace}`);

      } else if (parsedUrl.pathname === '/yakbak/reset-namespace/') {
        debug(`Reset namespace to default`);
        var previousNamespace = currentNamespace;
        currentNamespace = defaultNamespace;

        var dirName = path.join(opts.dirname, previousNamespace);
        if (fs.existsSync(dirName)) {
          fs.readdirSync(dirName).forEach(file => {
            if (!namespaceStats[previousNamespace].used.includes(file)) {
              namespaceStats[previousNamespace].orphans.push(file);
            }
          });
        }

        throw new NamespaceMethodSuccess(JSON.stringify(namespaceStats[previousNamespace]));
      }

      var file = path.join(opts.dirname, currentNamespace, tapename(req, body));
      debug('req / file:', req.url, file);

      return Promise.try(function () {
        return require.resolve(file);
      }).catch(ModuleNotFoundError, function (/* err */) {

        if (opts.noRecord) {
          /* eslint-disable no-console */
          console.log(`[${host}] An HTTP request has been made that yakbak does not know how to handle: `);
          console.log(`[${host}] namespace: ${currentNamespace}`);
          console.log(`[${host}] requested url: ${req.url}`);
          console.log(curl.request(req, body));

          namespaceStats[currentNamespace].errors.push(req.url);

          /* eslint-enable no-console */
          throw new RecordingDisabledError('Recording Disabled');
        } else {
          return proxy(req, body, host).then(function (pres) {
            return record(pres.req, body, pres, file, opts.verbose, currentNamespace);
          });
        }

      });
    }).then(function (file) {
      namespaceStats[currentNamespace].used.push(path.basename(file));
      return require(file);
    }).then(function (tape) {
      return tape(req, res);
    }).catch(RecordingDisabledError, function (err) {
      res.statusCode = err.status;
      res.end(err.message);
    }).catch(NamespaceMethodError, function (err) {
      res.statusCode = err.status;
      res.end(err.message);
    }).catch(NamespaceMethodSuccess, function (msg) {
      msg.statusCode = msg.status;
      res.end(msg.message);
    });

  };

};

/**
 * Returns the tape name for 'req`.
 * @param {http.IncomingMessage} req
 * @param {Array.<Buffer>} body
 * @returns {String}
 */

function tapename(req, body) {
  return hash.sync(req, Buffer.concat(body)) + '.js';
}

/**
 * Bluebird error predicate for matching module not found errors.
 * @param {Error} err
 * @returns {Boolean}
 */

function ModuleNotFoundError(err) {
  return err.code === 'MODULE_NOT_FOUND';
}

/**
 * Error class that is thrown when an unmatched request
 * is encountered in noRecord mode
 * @constructor
 */

function RecordingDisabledError(message) {
  this.message = message;
  this.status = 404;
}

RecordingDisabledError.prototype = Object.create(Error.prototype);


function NamespaceMethodSuccess(message) {
  this.message = message;
  this.status = 200;
}

function NamespaceMethodError(message) {
  this.message = message;
  this.status = 400;
}
NamespaceMethodSuccess.prototype = Object.create(Error.prototype);
NamespaceMethodError.prototype = Object.create(Error.prototype);
