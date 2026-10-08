# Sprint2go: one container with the built app and its server. Data (the SQLite database) lives in /app/data.
FROM node:24-alpine
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0 S2G_DATA=/app/data
EXPOSE 8787
VOLUME ["/app/data"]
CMD ["node", "--import", "./server/register.mjs", "server/index.ts"]
