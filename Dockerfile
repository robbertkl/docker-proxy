FROM robbertkl/node:latest
MAINTAINER Robbert Klarenbeek <robbertkl@renbeek.nl>

RUN apk add --no-cache \
        nginx \
        py-psutil \
        py-configargparse \
        py-configobj \
        py-cparser

RUN apk add --no-cache \
        --repository http://dl-cdn.alpinelinux.org/alpine/edge/community \
        certbot

COPY acme-challenge /etc/nginx/
RUN rm -rf /var/www/*
RUN openssl req \
        -x509 \
        -newkey rsa:2048 \
        -keyout /etc/ssl/private/snakeoil.key \
        -out /etc/ssl/certs/snakeoil.pem \
        -days 365 \
        -nodes \
        -subj "/CN=INVALID HOST"

COPY package.json ./
RUN npm install
COPY . .

VOLUME /etc/letsencrypt

EXPOSE 80
EXPOSE 443
