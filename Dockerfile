FROM node:24-bookworm-slim@sha256:a5f4366e834695d5f363b920c104953a535d3a9864d1bdf74566a0ebe01daee5 AS development
WORKDIR /app
ENV NODE_ENV=development npm_config_cache=/tmp/npm-cache
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund && chown -R node:node /app
COPY --chown=node:node . .
RUN mkdir -p /app/.local && chown node:node /app/.local
USER node
CMD ["npm", "run", "dev:api"]
