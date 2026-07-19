FROM node:18-alpine

WORKDIR /app

# Install dumb-init for proper signal handling
RUN apk add --no-cache dumb-init

COPY package*.json ./
RUN npm ci --only=production && npm cache clean --force

COPY . .

# PORT is injected by Railway — no EXPOSE directive (SKILLS.md)
# No HEALTHCHECK — Railway uses its own health monitoring

CMD ["dumb-init", "node", "src/index.js"]
