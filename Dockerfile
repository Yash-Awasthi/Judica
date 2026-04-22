# 1. Builder Stage
FROM node:22-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f AS builder

# Build tools needed for native modules (argon2, isolated-vm)
RUN apk add --no-cache python3 make g++

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

# Install production-only dependencies in a clean directory
RUN mkdir /app/prod_modules && cp package*.json /app/prod_modules/ && cd /app/prod_modules && npm ci --omit=dev

# 2. Production Stage
# L-13: Alpine is used for compatibility with native modules (argon2, isolated-vm) that require glibc/musl.
# For further hardening, consider switching to a distroless Node image (e.g. gcr.io/distroless/nodejs22-debian12)
# once native module compatibility is confirmed — distroless omits the shell and reduces attack surface.
FROM node:22-alpine@sha256:8ea2348b068a9544dae7317b4f3aafcdc032df1647bb7d768a05a5cad1a7683f AS runner

WORKDIR /app

ENV NODE_ENV=production

# Copy production node_modules from builder (already compiled native modules)
COPY --from=builder /app/prod_modules/node_modules ./node_modules
COPY --from=builder /app/package.json ./

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
