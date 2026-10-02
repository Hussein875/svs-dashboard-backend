FROM node:24-bookworm-slim

WORKDIR /app

COPY package.json ./
COPY src ./src
COPY regeln ./regeln

ENV GUTACHTEN_DB=/data/gutachten.sqlite
ENV PORT=3090

EXPOSE 3090

CMD ["node", "src/server.js"]
