'use strict';

const crypto = require('crypto');
const EventEmitter = require('events');
const execFile = require('child_process').execFile;
const fs = require('fs');
const spawn = require('child_process').spawn;

const privateData = new WeakMap();

module.exports =
class Nginx {
  constructor(options) {
    options = options || {};
    if (typeof options === 'string') options = { configFilePath: options };
    privateData.set(this, {
      executablePath: options.executablePath || '/usr/sbin/nginx',
      configFilePath: options.configFilePath || `/etc/nginx/nginx-${crypto.pseudoRandomBytes(6).toString('hex')}.conf`,
      config: null,
      process: null,
      eventEmitter: new EventEmitter(),
    });
  }

  on() {
    const data = privateData.get(this);
    EventEmitter.prototype.on.apply(data.eventEmitter, arguments);
  }

  start(config, callback) {
    if (typeof config === 'function') {
      callback = config;
    } else {
      const that = this;
      return this.updateConfig(config, function(error) {
        if(error) return callback(error);
        that.start(callback);
      });
    }

    const data = privateData.get(this);
    if (data.process) return callback(new Error('Cannot start NGINX: already running'));
    if (!data.config) return callback(new Error('Cannot start NGINX: please set a config first'));

    data.process = spawn(data.executablePath, ['-c', data.configFilePath, '-g', 'daemon off;']);
    data.process.on('exit', function(code, signal) { data.eventEmitter.emit('exit', code, signal); });

    callback();
  }

  stop(callback) {
    const data = privateData.get(this);
    if (!data.process) return callback(new Error('Cannot stop NGINX: not running'));

    data.process.on('close', function (code, signal) {
      data.process = null;
      callback();
    });
    data.process.kill('SIGTERM');
  }

  reload() {
    const data = privateData.get(this);
    if (!data.process) return callback(new Error('Cannot reload NGINX: not running'));

    data.eventEmitter.emit('reload');
    data.process.kill('SIGHUP');
  }

  testConfig(config, callback) {
    const data = privateData.get(this);
    const configFilePathTest = `${data.configFilePath}-test`;
    fs.writeFile(configFilePathTest, config, function(error) {
      if (error) return callback(error);
      execFile(data.executablePath, ['-c', configFilePathTest, '-q', '-t'], function(error, stdout, stderr) {
        if (error) {
          let lines = stderr.trim().split('\n');
          let filtered = [];
          for (let line of lines) {
            let matches = line.match(/^nginx: \[.*\] (.*)$/);
            if (!matches) continue;
            filtered.push(matches[1]);
          }
          return callback(new Error(`Cannot update NGINX config: ${filtered.join(', ')}`));
        }
        callback();
      });
    });
  }

  updateConfig(config, forceReload, callback) {
    if (typeof forceReload === 'function') return this.updateConfig(config, false, forceReload);

    const data = privateData.get(this);
    if (config === data.config) {
      if (forceReload && data.process) this.reload();
      return callback();
    }

    const that = this;
    this.testConfig(config, function(error) {
      if (error) return callback(error);
      fs.writeFile(data.configFilePath, config, function(error) {
        if (error) return callback(error);
        data.config = config;
        if (data.process) that.reload();
        callback();
      });
    });
  }
}
