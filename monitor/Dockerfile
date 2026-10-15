FROM node:22-alpine AS web
WORKDIR /web
COPY web/package.json ./
RUN npm install --no-audit --no-fund
COPY web/ ./
RUN npm run build

FROM node:22-alpine
WORKDIR /app
COPY api/package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY api/ ./
COPY --from=web /web/dist ./public
USER node
EXPOSE 8080
CMD ["node", "server.js"]
