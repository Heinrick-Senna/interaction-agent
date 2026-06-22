FROM node:22-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:22-alpine AS production
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev
COPY --from=builder /app/dist ./dist
RUN mkdir -p /app/data
# Required for auto-deploy: git pull + docker build from webhook
RUN apk add --no-cache git docker-cli docker-cli-compose
EXPOSE 3000
CMD ["node", "dist/main"]
