FROM node:22-slim

RUN apt-get update && apt-get install -y \
    docker.io \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci --production

COPY dist/ ./dist/
COPY container/ ./container/
COPY groups/ ./groups/
COPY skills/ ./skills/

RUN mkdir -p /app/data

ENTRYPOINT ["node", "dist/index.js"]
