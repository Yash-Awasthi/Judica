# 1. Builder Stage
FROM node:22-alpine AS builder

WORKDIR /app

# Copy root package files and install backend dependencies
COPY package*.json ./
RUN npm ci

# Install frontend dependencies before running the build
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci

# Copy all source
COPY tsconfig.json ./
COPY drizzle.config.ts ./
COPY src/ ./src/
COPY frontend/ ./frontend/

# Build everything (frontend + TypeScript compile)
RUN npm run build

# 2. Production Stage
FROM node:22-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy package files and install only production dependencies
COPY package*.json ./
RUN npm ci --omit=dev

# Copy built artifacts from the builder stage
COPY --from=builder /app/dist ./dist

# Remove source maps from production image
RUN find dist -name '*.map' -delete

RUN chown -R node:node /app
USER node

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

CMD ["node", "dist/index.js"]
