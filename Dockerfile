FROM node:24-bookworm-slim AS development
WORKDIR /app
ENV NODE_ENV=development npm_config_cache=/tmp/npm-cache
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund && chown -R node:node /app
COPY --chown=node:node . .
RUN mkdir -p /app/.local && chown node:node /app/.local
USER node
CMD ["npm", "run", "dev:api"]
