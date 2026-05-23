FROM nginx:1.27-alpine

COPY . /usr/share/nginx/html
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/local.config.js /usr/share/nginx/html/js/config.js

EXPOSE 3000
