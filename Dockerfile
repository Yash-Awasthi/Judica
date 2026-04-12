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

RUN chown -R node:node /app
USER node

EXPOSE 3000

CMD ["node", "dist/index.js"]
