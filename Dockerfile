FROM node:20-bookworm-slim

WORKDIR /app

RUN apt-get update \
    && apt-get install -y --no-install-recommends openssl \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./

RUN npm ci

COPY prisma ./prisma

RUN npx prisma generate

COPY src ./src
COPY scripts ./scripts

RUN mkdir -p /app/uploads /app/logs

ENV NODE_ENV=production

EXPOSE 3000

# CMD ["sh", "-c", "npx prisma migrate deploy && node src/server.js"]

CMD ["node", "src/server.js"]