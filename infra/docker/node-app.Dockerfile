# Runtime image for apps/api and apps/worker. Build the bundle on the host first (scripts/stack.sh up does
# it): `nx build <app>` writes dist/apps/<app> with a pruned package.json and lockfile of public packages only.
FROM node:24.22.1-alpine
ARG APP
WORKDIR /app
ENV NODE_ENV=production
COPY dist/apps/${APP}/package.json dist/apps/${APP}/package-lock.json ./
RUN npm ci --omit=dev --no-audit --fund=false --ignore-scripts && npm cache clean --force
COPY dist/apps/${APP}/ ./
USER node
CMD ["node", "main.js"]
