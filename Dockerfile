# Pinned to the 20.20 minor (matches the Node version CI and the Pi currently
# run) rather than floating node:20 so a surprise minor bump can't change the
# runtime under us. Bump deliberately.
FROM node:20.20-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --chown=node:node . .
# /app/uploads is normally a bind mount on the Pi (owned by uid 1000, same as
# the `node` user below — verified against the running image). Keep the mkdir
# + chown so the image also works without the mount: upload.js's mkdirSync at
# require time runs as `node`, which can't create dirs under root-owned /app.
RUN mkdir -p /app/uploads && chown node:node /app/uploads
USER node
EXPOSE 3000
# busybox wget ships with alpine; /health is a cheap JSON liveness route.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD wget -qO- http://localhost:3000/health || exit 1
CMD ["node", "src/app.js"]
