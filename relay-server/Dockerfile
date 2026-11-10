FROM node:22-alpine

ENV NODE_ENV=production
ENV PORT=8787
ENV RELAY_DATA_DIR=/data

WORKDIR /app
COPY --chown=node:node package.json ./package.json
COPY --chown=node:node index.js ./index.js
RUN mkdir /data && chown node:node /data
USER node

EXPOSE 8787
CMD ["node", "index.js"]
