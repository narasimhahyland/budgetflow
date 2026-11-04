# 0005 Container images from host bundles; MinIO pinned by digest

## Context

The api, worker and web containers need the monorepo build, which needs the private `@hylandsoftware` packages (web only). Docker builds should not need the registry token. Separately, MinIO no longer publishes `minio/minio` release tags on Docker Hub.

## Decision

- `scripts/stack.sh up` builds the bundles on the host (`nx build api worker web`). The api and worker images copy `dist/apps/<app>` and install its pruned `package.json` and lockfile, which contain only public packages (`generatePackageJson`). The web image is nginx-unprivileged serving `dist/apps/web/browser` with an `/api` proxy. `.dockerignore` sends only those bundles to the build context.
- Images are pinned: `postgres:16.11-alpine`, `quay.io/keycloak/keycloak:26.4.7`, `axllent/mailpit:v1.28.0`, `node:24.22.1-alpine`, `nginxinc/nginx-unprivileged:1.29.3-alpine`, and MinIO as `chainguard/minio:latest-dev@sha256:6d4f84fa…` (digest pin; the dev variant has a shell for the health check).
- In the local stack the API container runs migrations as the owner role before starting.

## Consequences

- Updating MinIO means updating the digest. A production deployment would run migrations as a separate job and not give the API owner credentials.
