# robbertkl/proxy

[![](https://badge.imagelayers.io/robbertkl/proxy:latest.svg)](https://imagelayers.io/?images=robbertkl/proxy:latest)

Automated reverse proxy for Docker containers. While similar to [jwilder/nginx-proxy](https://github.com/jwilder/nginx-proxy), the main additional feature is fully automated SSL configuration using Let's Encrypt. Each virtual host gets its own SSL certificate, which is automatically renewed periodically.

## Usage

Run like this:

```
docker run -d -e LETSENCRYPT_EMAIL=name@example.org -v /var/run/docker.sock:/var/run/docker.sock:ro -p 80:80 -p 443:443 robbertkl/proxy
```

If you'd like to use a custom NGINX configuration template, just bind mount it with `-v <path-to-template>:/usr/src/app/nginx.conf.tmpl`.

Run your web containers like this:

```
docker run -d -l nl.lapulapu.proxy.host=example.org,www.example.org <image>
```

For HTTP basic authentication you can bind mount a directory with your password file(s) using `-v <path-to-passwd-dir>:/etc/nginx/htpasswd`. You can then use the label `nl.lapulapu.proxy.auth=<filename>` when starting a container to enable HTTP basic authentication for that container.

## Environment variables

For the proxy container:

* `LETSENCRYPT_EMAIL` (e-mail address to use for Let's Encrypt)

## Labels

For your web containers:

* `nl.lapulapu.proxy.host=` (1 or more hostnames, comma-separated)
* `nl.lapulapu.proxy.auth=` (file for HTTP basic authentication, absolute or relative to `/etc/nginx/htpasswd`)

## Authors

* Robbert Klarenbeek, <robbertkl@renbeek.nl>

## License

This repo is published under the [MIT License](http://www.opensource.org/licenses/mit-license.php).
