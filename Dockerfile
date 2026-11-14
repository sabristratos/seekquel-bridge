FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci
COPY src ./src
RUN npx tsc -p tsconfig.json --outDir dist --rootDir . --noEmit false \
    && rm -rf dist/test

FROM node:22-alpine
LABEL org.opencontainers.image.source="https://github.com/sabristratos/seekquel-bridge" \n      org.opencontainers.image.description="Logs Audiobookshelf listening into Seekquel" \n      org.opencontainers.image.licenses="MIT"
ENV NODE_ENV=production DATA_DIR=/data STATUS_PORT=4410
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist
COPY assets ./assets
RUN mkdir /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 4410
HEALTHCHECK --interval=1m --timeout=5s --start-period=20s \
  CMD wget -qO- http://127.0.0.1:4410/health >/dev/null || exit 1
CMD ["node", "dist/src/main.js"]
