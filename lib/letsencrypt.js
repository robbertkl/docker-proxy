'use strict';

const async = require('async');
const EventEmitter = require('events');
const fs = require('fs');
const path = require('path');
const execFile = require('child_process').execFile;

const privateData = new WeakMap();

module.exports =
class LetsEncrypt {
  constructor(options) {
    options = options || {};
    if (typeof options === 'string') options = { email: options };
    privateData.set(this, {
      email: options.email || null,
      staging: options.staging || false,
      webroot: options.webroot || '/var/www',
      executablePath: options.executablePath || '/usr/bin/certbot',
      configPath: options.configPath || '/etc/letsencrypt',
      opensslExecutablePath: options.opensslExecutablePath || '/usr/bin/openssl',
      minimumValidity: options.minimumValidity || 30,
      cache: {},
      execQueue: async.priorityQueue(function(task, callback) { execFile(task.file, task.args, callback); }),
      eventEmitter: new EventEmitter(),
      watchTimer: null,
      watchTimeout: options.watchTimeout || 4 * 60 * 60 * 1000,
    });
  }

  on() {
    const data = privateData.get(this);
    EventEmitter.prototype.on.apply(data.eventEmitter, arguments);
  }

  _fetchFromFile(hostname, callback) {
    const data = privateData.get(this);

    let dir = path.resolve(data.configPath, 'live', hostname);
    let certificate = {
      dir: dir,
      cert: path.join(dir, 'cert.pem'),
      key: path.join(dir, 'privkey.pem'),
      chain: path.join(dir, 'chain.pem'),
      fullchain: path.join(dir, 'fullchain.pem'),
    };

    fs.access(certificate.dir, function(error) {
      if (error) return callback(null, null);
      execFile(data.opensslExecutablePath, ['x509', '-in', certificate.cert, '-noout', '-dates', '-fingerprint', '-subject'], function(error, stdout) {
        if (error) return callback(error);
        for (let line of stdout.trim().split('\n')) {
          const index = line.indexOf('=');
          const key = line.substr(0, index);
          const value = line.substr(index + 1);
          switch(key) {
            case 'notBefore':
              certificate.startDate = new Date(value);
              break;
            case 'notAfter':
              certificate.endDate = new Date(value);
              break;
            case 'SHA1 Fingerprint':
              certificate.fingerprint = value;
              break;
            case 'subject':
              for (let pair of value.replace(/^\s+\/?|\/?\s+$/gm).split('/')) {
                if (!pair.match(/^CN=.*$/)) continue;
                if (pair != `CN=${hostname}`) return callback(new Error('Certificate Common Name does not match hostname'));
                break;
              }
              break;
          }
        }
        data.cache[hostname] = certificate;
        callback(null, certificate);
      });
    });
  }

  _fetchCached(hostname, callback) {
    const data = privateData.get(this);
    if (hostname in data.cache) return callback(null, data.cache[hostname]);
    this._fetchFromFile(hostname, callback);
  }

  fetch(hostname, callback) {
    const data = privateData.get(this);
    const that = this;
    this._fetchCached(hostname, function(error, certificate) {
      if (error) return callback(error);
      if (certificate) {
        let now = new Date();
        if (certificate.startDate < now && now < certificate.endDate) {
          // We have a valid certificate
          let cutoffDate = new Date(certificate.endDate.valueOf());
          cutoffDate.setDate(cutoffDate.getDate() - data.minimumValidity);
          // If it expires soon (within the next ${minimumValidity} days), queue a low-priority renewal
          if (cutoffDate < now) that.renew(hostname, true, function() {});
          callback(null, certificate);
        } else {
          // We have an invalid certificate
          that.renew(hostname, callback);
        }
      } else {
        // We don't have any certificate, request a new one
        that.request(hostname, callback);
      }
    });
  }

  _call(event, hostname, additionalArguments, lowPriority, callback) {
    if (typeof lowPriority === 'function') {
      callback = lowPriority;
      lowPriority = false;
    }
    const data = privateData.get(this);

    const task = {
      file: data.executablePath,
      args: [
        'certonly',
        '--agree-tos',
        '--domain', hostname,
        '--authenticator', 'webroot',
        '--webroot-path', data.webroot,
        '--config-dir', data.configPath,
      ],
    };

    if (data.staging) {
      task.args.push('--staging');
    }

    if (data.email) {
      task.args.push('--email', data.email);
    } else {
      task.args.push('--register-unsafely-without-email');
    }

    Array.prototype.push.apply(task.args, additionalArguments)

    const that = this;
    data.execQueue.push(task, lowPriority ? 20 : 10, function(error, stdout, stderr) {
      if (error) return callback(new Error(stderr.trim()));
      that._fetchFromFile(hostname, function(error, certificate) {
        if (error) return callback(error);
        if (!certificate) return callback(new Error('Successful request, but no certificate found'));
        data.eventEmitter.emit(event, hostname, certificate);
        callback(null, certificate);
      });
    });
  }

  request(hostname, lowPriority, callback) {
    this._call('request', hostname, [], lowPriority, callback);
  }

  renew(hostname, lowPriority, callback) {
    this._call('renew', hostname, ['--renew-by-default'], lowPriority, callback);
  }

  watch(hostnames) {
    const data = privateData.get(this);
    const that = this;

    if (data.watchTimer) {
      clearInterval(data.watchTimer);
    }

    data.watchTimer = setInterval(function() {
      hostnames.forEach(function (hostname) {
        that.fetch(hostname, function() {});
      });
    }, data.watchTimeout);
  }
}
