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
      labelPrefix: options.labelPrefix || 'proxy',
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
      gatherHosts.bind(null, data.docker, data.labelPrefix, data.passwordDirectory),
      appendCertificates.bind(null, data.letsencrypt),
      function(hosts, callback) {
        callback(null, mustache.render(data.template, { hosts: hosts }));
      }
    ], callback);
  }
}

function gatherHosts(docker, labelPrefix, passwordDirectory, callback) {
  docker.listContainers(function(error, containerInfos) {
    const containers = containerInfos.map(function(containerInfo) {
      return docker.getContainer(containerInfo.Id);
    });
    async.map(containers, getContainerHostData.bind(null, labelPrefix), function(error, containerHostDatas) {
      if (error) return callback(error);

      let hostsMap = {}
      for (let containerHostData of containerHostDatas) {
        if (!containerHostData) continue;
        for (let hostname in containerHostData.hosts) {
          if (!(hostname in hostsMap)) hostsMap[hostname] = { hostname: hostname, upstream: [] };
          const host = hostsMap[hostname];
          host.upstream.push(`${containerHostData.address}:${containerHostData.hosts[hostname]}`);
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

function getContainerHostData(labelPrefix, container, callback) {
  container.inspect(function(error, data) {
    if (error) return callback(error);

    if (!('Config' in data)) return callback(new Error(`Missing section Config in inspect data of container ${container.id.substr(0, 12)}`));
    if (!('Labels' in data.Config)) return callback();

    let virtualHostsAndPorts = {};
    let passwordFile = null;

    for (let label in data.Config.Labels) {
      const value = data.Config.Labels[label];
      switch (label) {
        case `${labelPrefix}.host`:
          const entries = value.split(',').map(Function.prototype.call, String.prototype.trim);
          for (let entry of entries) {
            const parts = entry.split(':', 2);
            const host = parts[0];
            const port = (parts.length > 1) ? parseInt(parts[1]) : null;
            virtualHostsAndPorts[host] = port;
          }
          break;
        case `${labelPrefix}.users`:
          passwordFile = value;
          break;
      }
    }

    if (Object.keys(virtualHostsAndPorts).length === 0) return callback();

    if (!('NetworkSettings' in data)) return callback(new Error(`Missing section NetworkSettings in inspect data of container ${container.id.substr(0, 12)}`));

    let defaultPort = null;
    for (let host in virtualHostsAndPorts) {
      if (virtualHostsAndPorts[host]) continue;
      if (!defaultPort) {
        if (!('Ports' in data.NetworkSettings)) return callback(new Error(`Missing property Ports in NetworkSettings of container ${container.id.substr(0, 12)}`));
        if ('80/tcp' in data.NetworkSettings.Ports) {
          defaultPort = 80;
        } else if ('8080/tcp' in data.NetworkSettings.Ports) {
          defaultPort = 8080;
        } else {
          for (let port in data.NetworkSettings.Ports) {
            if (port.match(/\/tcp$/)) {
              defaultPort = parseInt(port.split('/')[0]);
              break;
            }
          }
        }
        if (!defaultPort) return callback();
      }
      virtualHostsAndPorts[host] = defaultPort;
    }

    if (!('IPAddress' in data.NetworkSettings)) return callback(new Error(`Missing property IPAddress in NetworkSettings of container ${container.id.substr(0, 12)}`));

    let virtualAddress = data.NetworkSettings.IPAddress;

    callback(null, {
      container: container.id,
      hosts: virtualHostsAndPorts,
      address: virtualAddress,
      htpasswd: passwordFile,
    });
  });
}
