# 1. Builder Stage
FROM node:20-alpine AS builder

WORKDIR /app

# Copy root package files and install backend dependencies
COPY package*.json ./
COPY prisma/ ./prisma/
RUN npm ci && npm install prisma @prisma/client @prisma/adapter-pg pg

# FIX: install frontend dependencies before running the build.
# Without this, `npm run build --prefix frontend` fails because
# vite, react, etc. are not present.
COPY frontend/package*.json ./frontend/
RUN cd frontend && npm ci

# Copy all source
COPY tsconfig.json ./
COPY src/ ./src/
COPY frontend/ ./frontend/

# Generate Prisma client and build everything
RUN npx prisma generate
RUN npm run build

# 2. Production Stage
FROM node:20-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy package files and install only production dependencies
COPY package*.json ./
COPY prisma/ ./prisma/
RUN npm ci --omit=dev && npm install @prisma/client @prisma/adapter-pg pg

# Generate Prisma client for runtime
RUN npx prisma generate

# Copy built artifacts from the builder stage
COPY --from=builder /app/dist ./dist

RUN chown -R node:node /app
USER node

EXPOSE 3000

CMD ["node", "dist/index.js"]
