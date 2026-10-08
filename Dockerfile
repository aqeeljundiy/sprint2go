# Sprint2go: one container with the built app, its server and the mail engine (SMTP on 25). Data lives in /app/data.
FROM node:24-alpine
RUN apk add --no-cache openssl
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0 S2G_DATA=/app/data
EXPOSE 8787 25
VOLUME ["/app/data"]
CMD ["node", "--import", "./server/register.mjs", "server/index.ts"]
