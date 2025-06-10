FROM node:18

WORKDIR /app
COPY server /app/server
COPY public /app/public

RUN cd server && npm install

CMD ["node", "server/server.js"]
