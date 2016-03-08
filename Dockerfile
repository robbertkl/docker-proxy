FROM robbertkl/node
MAINTAINER Robbert Klarenbeek <robbertkl@renbeek.nl>

# Install Nginx (mainline) and Let's Encrypt
RUN curl -sSL http://nginx.org/keys/nginx_signing.key | apt-key add - \
    && echo "deb http://nginx.org/packages/mainline/debian/ `lsb_release -cs` nginx" >> /etc/apt/sources.list
RUN cleaninstall \
    dialog \
    gcc \
    libffi-dev \
    libssl-dev \
    nginx \
    python \
    python-dev \
    python-pip \
    ssl-cert
RUN pip install -U letsencrypt
RUN mkdir -p /var/www
COPY acme-challenge /etc/nginx/

# Install the app itself
COPY package.json ./
RUN npm install
COPY . .

# Let's Encrypt certificates and account info are kept in a volume
VOLUME /etc/letsencrypt

# Expose HTTP and HTTPS
EXPOSE 80
EXPOSE 443
