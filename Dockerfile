FROM node:22-alpine
WORKDIR /app
COPY package.json server.js agent-board.html ./
ENV HOST=0.0.0.0 PORT=3000 DATA_DIR=/data
RUN mkdir -p /data && chown node:node /data
VOLUME /data
EXPOSE 3000
USER node
CMD ["node", "server.js"]
