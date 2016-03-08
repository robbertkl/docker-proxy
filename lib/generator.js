'use strict';

const async = require('async');
const fs = require('fs');
const mustache = require('mustache');
const path = require('path');

const privateData = new WeakMap();

module.exports =
class Generator {
  constructor(docker, letsencrypt, template, options) {
    options = options || {};
    privateData.set(this, {
      docker: docker,
      letsencrypt: letsencrypt,
      template: template,
      passwordDirectory: options.passwordDirectory || '/etc/nginx/htpasswd/',
    });
  }

  empty() {
    const data = privateData.get(this);
    return mustache.render(data.template, {});
  }

  generate(callback) {
    const data = privateData.get(this);
    async.waterfall([
      gatherHosts.bind(null, data.docker, data.passwordDirectory),
      appendCertificates.bind(null, data.letsencrypt),
      function(hosts, callback) {
        callback(null, mustache.render(data.template, { hosts: hosts }));
      }
    ], callback);
  }
}

function gatherHosts(docker, passwordDirectory, callback) {
  docker.listContainers(function(error, containerInfos) {
    const containers = containerInfos.map(function(containerInfo) {
      return docker.getContainer(containerInfo.Id);
    });
    async.map(containers, getContainerHostData, function(error, containerHostDatas) {
      if (error) return callback(error);

      let hostsMap = {}
      for (let containerHostData of containerHostDatas) {
        if (!containerHostData) continue;
        for (let hostname of containerHostData.hosts) {
          if (!(hostname in hostsMap)) hostsMap[hostname] = { hostname: hostname, upstream: [] };
          const host = hostsMap[hostname];
          host.upstream.push(containerHostData.backend);
          if (containerHostData.htpasswd) host.htpasswd = path.resolve(passwordDirectory, containerHostData.htpasswd);
        }
      }

      let hosts = []
      for (let hostname in hostsMap) {
        if (hostsMap.hasOwnProperty(hostname)) {
          hosts.push(hostsMap[hostname]);
        }
      }

      callback(null, hosts);
    });
  });
}

function appendCertificates(letsencrypt, hosts, callback) {
  async.each(hosts, function(host, callback) {
    letsencrypt.fetch(host.hostname, function(error, certificate) {
      if (!error && certificate) {
        host.ssl = certificate;
      }
      callback();
    });
  }, function(error) {
    callback(error, hosts);
  });

  const hostnames = hosts.map(function(host) { return host.hostname; });
  letsencrypt.watch(hostnames);
}

function getContainerHostData(container, callback) {
  container.inspect(function(error, data) {
    if (error) return callback(error);

    if (!('Config' in data)) return callback(new Error(`Missing section Config in inspect data of container ${container.id.substr(0, 12)}`));
    if (!('Env' in data.Config)) return callback();

    let virtualHosts = [];
    let virtualPort = null;
    let passwordFile = null;

    for (let env of data.Config.Env) {
      const index = env.indexOf('=');
      const variable = env.substr(0, index);
      const value = env.substr(index + 1);
      switch (variable) {
        case 'VIRTUAL_HOST':
          virtualHosts = value.split(',').map(Function.prototype.call, String.prototype.trim);
          break;
        case 'VIRTUAL_PORT':
          virtualPort = value;
          break;
        case 'HTPASSWD_FILE':
          passwordFile = value;
          break;
      }
    }

    if (virtualHosts.length === 0) return callback();

    if (!('NetworkSettings' in data)) return callback(new Error(`Missing section NetworkSettings in inspect data of container ${container.id.substr(0, 12)}`));

    if (!virtualPort) {
      if (!('Ports' in data.NetworkSettings)) return callback(new Error(`Missing property Ports in NetworkSettings of container ${container.id.substr(0, 12)}`));
      if ('80/tcp' in data.NetworkSettings.Ports) {
        virtualPort = 80;
      } else if ('8080/tcp' in data.NetworkSettings.Ports) {
        virtualPort = 8080;
      } else {
        for (let port in data.NetworkSettings.Ports) {
          if (port.match(/\/tcp$/)) {
            virtualPort = parseInt(port.split('/')[0]);
            break;
          }
        }
      }
    }

    if (!virtualPort) return callback();

    if (!('IPAddress' in data.NetworkSettings)) return callback(new Error(`Missing property IPAddress in NetworkSettings of container ${container.id.substr(0, 12)}`));

    let virtualAddress = data.NetworkSettings.IPAddress;

    callback(null, {
      container: container.id,
      hosts: virtualHosts,
      backend: `${virtualAddress}:${virtualPort}`,
      htpasswd: passwordFile,
    });
  });
}
