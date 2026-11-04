# Serves the built Angular app (dist/apps/web/browser) and proxies /api and /health to the API service.
FROM nginxinc/nginx-unprivileged:1.29.3-alpine
COPY infra/docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY dist/apps/web/browser/ /usr/share/nginx/html/
EXPOSE 8080
