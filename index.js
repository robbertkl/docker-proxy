'use strict';

const fs = require('fs');
const path = require('path');

const DockerEvents = require('docker-events');
const Dockerode = require('dockerode');

const debounce = require('./lib/debounce');
const Generator = require('./lib/generator');
const LetsEncrypt = require('./lib/letsencrypt');
const Nginx = require('./lib/nginx');

function log(message) {
  let prefix = `${new Date().toISOString()} - `;
  if (typeof message === 'string') {
    process.stdout.write(`${prefix}${message}\n`);
  } else if(message) {
    process.stderr.write(`${prefix}${message.toString()}\n`);
  }
}

function fatal(error) {
  if (error) {
    process.stderr.write(`${error.toString()}\n`);
    exit(1);
  }
}

function exit(code) {
  log('Exiting...');
  process.exit(code);
}

fs.readFile(path.resolve(__dirname, 'nginx.conf.tmpl'), 'UTF-8', function(error, template) {
  fatal(error);

  const docker = new Dockerode();
  const letsencrypt = new LetsEncrypt(process.env.LETSENCRYPT_EMAIL);
  const generator = new Generator(docker, letsencrypt, template, {labelPrefix: 'proxy'});
  const nginx = new Nginx(`/etc/nginx/nginx-${process.pid}.conf`);

  nginx.on('exit', function(code, signal) {
    let info = code === null ? `received ${signal}` : `exit status ${code}`;
    fatal(new Error(`NGINX process exited unexpectedly (${info})`));
  });

  nginx.on('reload', function() {
    log('Reloading NGINX');
  });

  let config = generator.empty();
  nginx.start(config, function(error) {
    fatal(error);
    log('NGINX started');

    const refresh = debounce(function(callback) {
      generator.generate(function(error, config) {
        log(error);
        if (error) return callback(error);
        nginx.updateConfig(config, function(error) {
          log(error);
          if (error) return callback(error);
          callback();
        });
      });
    });

    process.on('SIGHUP', function() {
      log('Received SIGHUP; refreshing');
      refresh();
    });

    process.on('SIGTERM', function() {
      log('Received SIGTERM; terminating NGINX process');
      nginx.stop();
      exit(0);
    });

    letsencrypt.on('request', function(hostname) {
      log(`Requested SSL certificate for ${hostname}`);
    });

    letsencrypt.on('renew', function(hostname) {
      log(`Renewed SSL certificate for ${hostname}`);
      refresh();
    });

    const events = new DockerEvents({ docker: docker });
    events.on('_message', function(message) {
      if (['start', 'stop', 'die'].indexOf(message.status) < 0) return;
      log(`Received Docker "${message.status}" event for container ${message.id.substr(0, 12)}`);
      refresh();
    });
    events.start();

    refresh();
  });
});
