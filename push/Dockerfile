FROM oven/bun:1-alpine
WORKDIR /app
COPY package.json bun.lock ./
RUN bun install --frozen-lockfile --production
COPY schedule.ts server.ts ./
ENV DATA_DIR=/data NODE_ENV=production
EXPOSE 3000
CMD ["bun", "server.ts"]
