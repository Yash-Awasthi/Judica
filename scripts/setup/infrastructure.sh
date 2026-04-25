#!/bin/bash

# AI Council Production Infrastructure Setup
# This script sets up production infrastructure components

set -e

echo "🏗️ AI Council Production Infrastructure Setup"
echo "============================================"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${BLUE}[INFO]${NC} $1"
}

print_success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

print_error() {
    echo -e "${RED}[ERROR]${NC} $1"
}

# Create production Docker Compose
create_production_docker_compose() {
    print_status "Creating production Docker Compose configuration..."
    
    cat > docker-compose.prod.yml << 'EOF'
version: '3.8'

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile.prod
    restart: unless-stopped
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://postgres:${POSTGRES_PASSWORD}@db:5432/ai_council_prod
      - REDIS_URL=redis://redis:6379
      - JWT_SECRET=${JWT_SECRET}
      - SESSION_SECRET=${SESSION_SECRET}
      - LOG_LEVEL=warn
      - METRICS_ENABLED=true
      - HEALTH_CHECKS_ENABLED=true
    volumes:
      - ./logs:/app/logs
      - ./ssl:/app/ssl:ro
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - ai-council-network
    deploy:
      replicas: 3
      resources:
        limits:
          memory: 1G
          cpus: '0.5'
        reservations:
          memory: 512M
          cpus: '0.25'

  nginx:
    image: nginx:alpine
    restart: unless-stopped
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/prod.conf:/etc/nginx/nginx.conf:ro
      - ./ssl:/etc/nginx/ssl:ro
      - ./logs/nginx:/var/log/nginx
    depends_on:
      - app
    networks:
      - ai-council-network
    deploy:
      resources:
        limits:
          memory: 256M
          cpus: '0.25'

  db:
    image: postgres:14-alpine
    restart: unless-stopped
    environment:
      - POSTGRES_DB=ai_council_prod
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=${POSTGRES_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./backups:/backups
      - ./scripts/init-db-prod.sql:/docker-entrypoint-initdb.d/init-db.sql
    networks:
      - ai-council-network
    deploy:
      resources:
        limits:
          memory: 2G
          cpus: '1.0'
        reservations:
          memory: 1G
          cpus: '0.5'
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 30s
      timeout: 10s
      retries: 3
      start_period: 60s

  redis:
    image: redis:7-alpine
    restart: unless-stopped
    volumes:
      - redis_data:/data
      - ./redis/redis-prod.conf:/usr/local/etc/redis/redis.conf
    networks:
      - ai-council-network
    command: redis-server /usr/local/etc/redis/redis.conf
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: '0.25'
        reservations:
          memory: 256M
          cpus: '0.125'
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 30s
      timeout: 10s
      retries: 3

  prometheus:
    image: prom/prometheus:latest
    restart: unless-stopped
    ports:
      - "9090:9090"
    volumes:
      - ./monitoring/prometheus-prod.yml:/etc/prometheus/prometheus.yml:ro
      - prometheus_data:/prometheus
      - ./monitoring/rules:/etc/prometheus/rules
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--storage.tsdb.retention.time=30d'
      - '--web.console.libraries=/etc/prometheus/console_libraries'
      - '--web.console.templates=/etc/prometheus/consoles'
      - '--web.enable-lifecycle'
      - '--web.enable-admin-api'
    networks:
      - ai-council-network
    deploy:
      resources:
        limits:
          memory: 1G
          cpus: '0.5'
        reservations:
          memory: 512M
          cpus: '0.25'

  grafana:
    image: grafana/grafana:latest
    restart: unless-stopped
    ports:
      - "3001:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=${GRAFANA_PASSWORD}
      - GF_USERS_ALLOW_SIGN_UP=false
      - GF_SECURITY_ALLOW_EMBEDDING=true
      - GF_AUTH_ANONYMOUS_ENABLED=false
      - GF_INSTALL_PLUGINS=grafana-piechart-panel,grafana-worldmap-panel
    volumes:
      - grafana_data:/var/lib/grafana
      - ./monitoring/grafana/provisioning:/etc/grafana/provisioning:ro
      - ./monitoring/grafana/dashboards:/var/lib/grafana/dashboards:ro
    depends_on:
      - prometheus
    networks:
      - ai-council-network
    deploy:
      resources:
        limits:
          memory: 512M
          cpus: '0.25'
        reservations:
          memory: 256M
          cpus: '0.125'

  alertmanager:
    image: prom/alertmanager:latest
    restart: unless-stopped
    ports:
      - "9093:9093"
    volumes:
      - ./monitoring/alertmanager.yml:/etc/alertmanager/alertmanager.yml:ro
      - alertmanager_data:/alertmanager
    command:
      - '--config.file=/etc/alertmanager/alertmanager.yml'
      - '--storage.path=/alertmanager'
      - '--web.external-url=https://your-domain.com:9093'
    networks:
      - ai-council-network
    deploy:
      resources:
        limits:
          memory: 256M
          cpus: '0.125'
        reservations:
          memory: 128M
          cpus: '0.0625'

  node-exporter:
    image: prom/node-exporter:latest
    restart: unless-stopped
    ports:
      - "9100:9100"
    volumes:
      - /proc:/host/proc:ro
      - /sys:/host/sys:ro
      - /:/rootfs:ro
    command:
      - '--path.procfs=/host/proc'
      - '--path.rootfs=/rootfs'
      - '--path.sysfs=/host/sys'
      - '--collector.filesystem.mount-points-exclude=^/(sys|proc|dev|host|etc)($$|/)'
    networks:
      - ai-council-network
    deploy:
      resources:
        limits:
          memory: 128M
          cpus: '0.125'
        reservations:
          memory: 64M
          cpus: '0.0625'

  postgres-exporter:
    image: prometheuscommunity/postgres-exporter:latest
    restart: unless-stopped
    ports:
      - "9187:9187"
    environment:
      - DATA_SOURCE_NAME=postgresql://postgres:${POSTGRES_PASSWORD}@db:5432/ai_council_prod?sslmode=disable
    depends_on:
      - db
    networks:
      - ai-council-network
    deploy:
      resources:
        limits:
          memory: 128M
          cpus: '0.125'
        reservations:
          memory: 64M
          cpus: '0.0625'

  redis-exporter:
    image: oliver006/redis_exporter:latest
    restart: unless-stopped
    ports:
      - "9121:9121"
    environment:
      - REDIS_ADDR=redis://redis:6379
    depends_on:
      - redis
    networks:
      - ai-council-network
    deploy:
      resources:
        limits:
          memory: 64M
          cpus: '0.0625'
        reservations:
          memory: 32M
          cpus: '0.03125'

volumes:
  postgres_data:
    driver: local
  redis_data:
    driver: local
  prometheus_data:
    driver: local
  grafana_data:
    driver: local
  alertmanager_data:
    driver: local

networks:
  ai-council-network:
    driver: bridge
    ipam:
      config:
        - subnet: 172.20.0.0/16
EOF
    
    print_success "Production Docker Compose created"
}

# Create production Dockerfile
create_production_dockerfile() {
    print_status "Creating production Dockerfile..."
    
    cat > Dockerfile.prod << 'EOF'
# Multi-stage build for production
FROM node:18-alpine AS builder

# Install build dependencies
RUN apk add --no-cache \
    python3 \
    py3-pip \
    make \
    g++ \
    openssl

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=production && npm cache clean --force

# Production stage
FROM node:18-alpine AS production

# Install runtime dependencies
RUN apk add --no-cache \
    curl \
    dumb-init \
    openssl \
    ca-certificates

# Create app user
RUN addgroup -g 1001 -S nodejs
RUN adduser -S nodejs -u 1001

WORKDIR /app

# Copy from builder
COPY --from=builder --chown=nodejs:nodejs /app/node_modules ./node_modules
COPY --from=builder --chown=nodejs:nodejs /app/package*.json ./
COPY --chown=nodejs:nodejs . .

# Create necessary directories
RUN mkdir -p logs ssl && chown -R nodejs:nodejs logs ssl

# Set permissions
RUN chmod +x scripts/*.sh

# Switch to non-root user
USER nodejs

# Expose port
EXPOSE 3000 9090

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start application
ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "start"]
EOF
    
    print_success "Production Dockerfile created"
}

# Create production Nginx configuration
create_production_nginx() {
    print_status "Creating production Nginx configuration..."
    
    mkdir -p nginx
    
    cat > nginx/prod.conf << 'EOF'
events {
    worker_connections 1024;
    use epoll;
    multi_accept on;
}

http {
    include /etc/nginx/mime.types;
    default_type application/octet-stream;

    # Logging
    log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                    '$status $body_bytes_sent "$http_referer" '
                    '"$http_user_agent" "$http_x_forwarded_for" '
                    'rt=$request_time uct="$upstream_connect_time" '
                    'uht="$upstream_header_time" urt="$upstream_response_time"';

    access_log /var/log/nginx/access.log main;
    error_log /var/log/nginx/error.log warn;

    # Performance settings
    sendfile on;
    tcp_nopush on;
    tcp_nodelay on;
    keepalive_timeout 65;
    types_hash_max_size 2048;
    client_max_body_size 10M;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_proxied any;
    gzip_comp_level 6;
    gzip_types
        text/plain
        text/css
        text/xml
        text/javascript
        application/json
        application/javascript
        application/xml+rss
        application/atom+xml
        image/svg+xml;

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=20r/s;
    limit_req_zone $binary_remote_addr zone=auth:10m rate=10r/s;
    limit_req_zone $binary_remote_addr zone=upload:10m rate=2r/s;
    limit_conn_zone $binary_remote_addr zone=conn_limit_per_ip:10m;

    # SSL configuration
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512:ECDHE-RSA-AES256-GCM-SHA384:DHE-RSA-AES256-GCM-SHA384;
    ssl_prefer_server_ciphers off;
    ssl_session_cache shared:SSL:10m;
    ssl_session_timeout 10m;
    ssl_session_tickets off;

    # Security headers
    add_header X-Frame-Options DENY always;
    add_header X-Content-Type-Options nosniff always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;
    add_header Content-Security-Policy "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https:; frame-ancestors 'none';" always;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;

    # Upstream configuration
    upstream ai_council {
        least_conn;
        server app:3000 max_fails=3 fail_timeout=30s;
        keepalive 32;
    }

    # HTTP to HTTPS redirect
    server {
        listen 80;
        server_name your-domain.com www.your-domain.com;
        return 301 https://$server_name$request_uri;
    }

    # HTTPS server
    server {
        listen 443 ssl http2;
        server_name your-domain.com www.your-domain.com;

        # SSL certificates
        ssl_certificate /etc/nginx/ssl/cert.pem;
        ssl_certificate_key /etc/nginx/ssl/key.pem;

        # SSL OCSP stapling
        ssl_stapling on;
        ssl_stapling_verify on;
        resolver 8.8.8.8 8.8.4.4 valid=300s;
        resolver_timeout 5s;

        # Connection limits
        limit_conn conn_limit_per_ip 20;

        # API endpoints with rate limiting
        location /api/ {
            limit_req zone=api burst=40 nodelay;
            
            proxy_pass http://ai_council;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_set_header X-Forwarded-Host $host;
            proxy_set_header X-Forwarded-Port $server_port;
            proxy_cache_bypass $http_upgrade;
            proxy_read_timeout 86400;
        }

        # Auth endpoints with stricter rate limiting
        location /api/auth/ {
            limit_req zone=auth burst=20 nodelay;
            
            proxy_pass http://ai_council;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_read_timeout 86400;
        }

        # Upload endpoints with strict rate limiting
        location /api/upload/ {
            limit_req zone=upload burst=5 nodelay;
            client_max_body_size 50M;
            
            proxy_pass http://ai_council;
            proxy_http_version 1.1;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_read_timeout 300;
            proxy_send_timeout 300;
        }

        # WebSocket support
        location /socket.io/ {
            proxy_pass http://ai_council;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection "upgrade";
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_read_timeout 86400;
        }

        # Static files with caching
        location /static/ {
            proxy_pass http://ai_council;
            expires 1y;
            add_header Cache-Control "public, immutable";
            add_header X-Cache-Status "STATIC";
        }

        # Health check
        location /health {
            proxy_pass http://ai_council;
            access_log off;
            expires 1m;
        }

        # Metrics endpoint
        location /metrics {
            proxy_pass http://ai_council;
            allow 127.0.0.1;
            allow 10.0.0.0/8;
            allow 172.16.0.0/12;
            allow 192.168.0.0/16;
            deny all;
        }

        # Default route
        location / {
            proxy_pass http://ai_council;
            proxy_http_version 1.1;
            proxy_set_header Upgrade $http_upgrade;
            proxy_set_header Connection 'upgrade';
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
            proxy_cache_bypass $http_upgrade;
            proxy_read_timeout 86400;
        }
    }
}
EOF
    
    print_success "Production Nginx configuration created"
}

# Create production Redis configuration
create_production_redis() {
    print_status "Creating production Redis configuration..."
    
    mkdir -p redis
    
    cat > redis/redis-prod.conf << 'EOF'
# Redis Production Configuration

# Network
bind 0.0.0.0
port 6379
timeout 0
tcp-keepalive 300
tcp-backlog 511

# Memory
maxmemory 1gb
maxmemory-policy allkeys-lru
maxmemory-samples 5

# Persistence
save 900 1
save 300 10
save 60 10000
stop-writes-on-bgsave-error yes
rdbcompression yes
rdbchecksum yes
dbfilename dump.rdb
dir /data

# AOF persistence
appendonly yes
appendfilename "appendonly.aof"
appendfsync everysec
no-appendfsync-on-rewrite no
auto-aof-rewrite-percentage 100
auto-aof-rewrite-min-size 64mb
aof-load-truncated yes

# Security
protected-mode no
requirepass ${REDIS_PASSWORD}

# Logging
loglevel notice
logfile ""
syslog-enabled yes
syslog-ident redis

# Performance
databases 16
always-show-logo yes
hash-max-ziplist-entries 512
hash-max-ziplist-value 64
list-max-ziplist-size -2
list-compress-depth 0
set-max-intset-entries 512
zset-max-ziplist-entries 128
zset-max-ziplist-value 64
hll-sparse-max-bytes 3000
stream-node-max-bytes 4096

# Client connections
maxclients 10000
tcp-keepalive 300

# Memory optimization
activerehashing yes
rehash-interval 100

# Slow log
slowlog-log-slower-than 10000
slowlog-max-len 128

# Latency monitoring
latency-monitor-threshold 100

# Event notification
notify-keyspace-events "Ex"

# Modules
# loadmodule /path/to/redis-modules.so

# Other settings
supervised no
pidfile /var/run/redis/redis-server.pid
EOF
    
    print_success "Production Redis configuration created"
}

# Create production database initialization
create_production_db_init() {
    print_status "Creating production database initialization script..."
    
    cat > scripts/init-db-prod.sql << 'EOF'
-- AI Council Production Database Initialization

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- Create indexes for performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS "chat_created_at_idx" ON "Chat"("createdAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "chat_user_created_at_idx" ON "Chat"("userId", "createdAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "conversation_user_updated_at_idx" ON "Conversation"("userId", "updatedAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "audit_log_user_created_at_idx" ON "AuditLog"("userId", "createdAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "audit_log_conversation_created_at_idx" ON "AuditLog"("conversationId", "createdAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "evaluation_user_timestamp_idx" ON "Evaluation"("userId", "timestamp");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "evaluation_session_idx" ON "Evaluation"("sessionId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "daily_usage_user_date_idx" ON "DailyUsage"("userId", "date");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "context_summary_conversation_created_at_idx" ON "ContextSummary"("conversationId", "createdAt");

-- Full-text search indexes
CREATE INDEX CONCURRENTLY IF NOT EXISTS "chat_question_gin_idx" ON "Chat" USING gin(to_tsvector('english', "question"));
CREATE INDEX CONCURRENTLY IF NOT EXISTS "chat_verdict_gin_idx" ON "Chat" USING gin(to_tsvector('english', "verdict"));

-- Performance optimization
ALTER SYSTEM SET shared_preload_libraries = 'pg_stat_statements';
ALTER SYSTEM SET max_connections = 200;
ALTER SYSTEM SET shared_buffers = '256MB';
ALTER SYSTEM SET effective_cache_size = '1GB';
ALTER SYSTEM SET work_mem = '4MB';
ALTER SYSTEM SET maintenance_work_mem = '64MB';
ALTER SYSTEM SET checkpoint_completion_target = 0.9;
ALTER SYSTEM SET wal_buffers = '16MB';
ALTER SYSTEM SET default_statistics_target = 100;
ALTER SYSTEM SET random_page_cost = 1.1;
ALTER SYSTEM SET effective_io_concurrency = 200;

-- Update statistics
ANALYZE;

-- Log initialization
DO $$
BEGIN
    RAISE NOTICE 'AI Council production database initialized successfully';
    RAISE NOTICE 'Extensions enabled: uuid-ossp, pg_stat_statements, pg_trgm';
    RAISE NOTICE 'Indexes created for optimal performance';
    RAISE NOTICE 'Configuration optimized for production workload';
END
$$;
EOF
    
    print_success "Production database initialization script created"
}

# Create production environment template
create_production_env() {
    print_status "Creating production environment template..."
    
    cat > .env.production << 'EOF'
# AI Council Production Environment Configuration

# Application
NODE_ENV=production
PORT=3000
FRONTEND_URL=https://your-domain.com

# Database
DATABASE_URL=postgresql://postgres:CHANGE_ME@localhost:5432/ai_council_prod
POSTGRES_PASSWORD=CHANGE_ME

# Redis
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=CHANGE_ME

# Security
JWT_SECRET=CHANGE_ME_GENERATE_32_BYTE_SECRET
SESSION_SECRET=CHANGE_ME_GENERATE_32_BYTE_SECRET
ENCRYPTION_KEY=CHANGE_ME_GENERATE_64_BYTE_HEX_KEY

# AI Providers
OPENAI_API_KEY=CHANGE_ME
ANTHROPIC_API_KEY=CHANGE_ME
GOOGLE_API_KEY=CHANGE_ME

# Cost Management
DEFAULT_DAILY_LIMIT=100.0
DEFAULT_MONTHLY_LIMIT=1000.0
COST_ALERTS_ENABLED=true

# Monitoring
METRICS_ENABLED=true
METRICS_PORT=9090
HEALTH_CHECKS_ENABLED=true

# Logging
LOG_LEVEL=warn

# Grafana
GRAFANA_PASSWORD=CHANGE_ME_SECURE_PASSWORD

# SSL
SSL_CERT_PATH=/app/ssl/cert.pem
SSL_KEY_PATH=/app/ssl/key.pem

# Backup
BACKUP_SCHEDULE=0 2 * * *
BACKUP_RETENTION_DAYS=30

# Performance
CLUSTER_WORKERS=4
MAX_MEMORY_USAGE=1024
CONNECTION_POOL_SIZE=20

# Security
RATE_LIMIT_WINDOW=900000
RATE_LIMIT_MAX_REQUESTS=100
SESSION_TIMEOUT=3600000

# Monitoring
PROMETHEUS_RETENTION=30d
ALERT_WEBHOOK_URL=CHANGE_ME
SLACK_WEBHOOK_URL=CHANGE_ME

# Email (for alerts)
SMTP_HOST=CHANGE_ME
SMTP_PORT=587
SMTP_USER=CHANGE_ME
SMTP_PASS=CHANGE_ME
SMTP_FROM=noreply@your-domain.com

# Local AI (if used)
OLLAMA_ENDPOINT=http://localhost:11434
LM_STUDIO_ENDPOINT=http://localhost:1234
LLAMACPP_ENDPOINT=http://localhost:8080

# Desktop Integrations
OBSIDIAN_ENDPOINT=http://localhost:42424
VSCODE_ENDPOINT=http://localhost:3000
EOF
    
    print_success "Production environment template created"
}

# Create infrastructure monitoring
create_infrastructure_monitoring() {
    print_status "Creating infrastructure monitoring configuration..."
    
    mkdir -p monitoring/rules
    
    cat > monitoring/prometheus-prod.yml << 'EOF'
global:
  scrape_interval: 15s
  evaluation_interval: 15s
  external_labels:
    cluster: 'production'
    replica: 'prod-1'

rule_files:
  - "rules/*.yml"

alerting:
  alertmanagers:
    - static_configs:
        - targets:
          - alertmanager:9093

scrape_configs:
  - job_name: 'ai-council'
    static_configs:
      - targets: ['app:3000']
    metrics_path: '/metrics'
    scrape_interval: 5s
    scrape_timeout: 10s

  - job_name: 'nginx'
    static_configs:
      - targets: ['nginx:80']
    metrics_path: '/metrics'
    scrape_interval: 10s

  - job_name: 'postgres'
    static_configs:
      - targets: ['postgres-exporter:9187']
    scrape_interval: 10s

  - job_name: 'redis'
    static_configs:
      - targets: ['redis-exporter:9121']
    scrape_interval: 10s

  - job_name: 'node-exporter'
    static_configs:
      - targets: ['node-exporter:9100']
    scrape_interval: 10s

  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']
    scrape_interval: 30s

remote_write:
  - url: "https://your-remote-prometheus.com/api/v1/write"
    basic_auth:
      username: "user"
      password: "password"
EOF
    
    # Create alerting rules
    cat > monitoring/rules/ai-council.yml << 'EOF'
groups:
  - name: ai-council.rules
    rules:
      - alert: HighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m]) > 0.05
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "High error rate detected"
          description: "Error rate is {{ $value | humanizePercentage }} for the last 5 minutes"

      - alert: HighResponseTime
        expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 2
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High response time detected"
          description: "95th percentile response time is {{ $value }}s"

      - alert: DatabaseConnectionFailure
        expr: up{job="postgres"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Database connection failure"
          description: "PostgreSQL database is down"

      - alert: RedisConnectionFailure
        expr: up{job="redis"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "Redis connection failure"
          description: "Redis cache is down"

      - alert: HighMemoryUsage
        expr: (node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes) / node_memory_MemTotal_bytes > 0.8
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High memory usage"
          description: "Memory usage is {{ $value | humanizePercentage }}"

      - alert: HighCPUUsage
        expr: 100 - (avg by(instance) (irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100) > 80
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "High CPU usage"
          description: "CPU usage is {{ $value }}%"

      - alert: DiskSpaceLow
        expr: (node_filesystem_avail_bytes / node_filesystem_size_bytes) < 0.1
        for: 5m
        labels:
          severity: critical
        annotations:
          summary: "Low disk space"
          description: "Disk space is {{ $value | humanizePercentage }}"

      - alert: ApplicationDown
        expr: up{job="ai-council"} == 0
        for: 1m
        labels:
          severity: critical
        annotations:
          summary: "AI Council application is down"
          description: "The AI Council application has been down for more than 1 minute"

      - alert: CostLimitWarning
        expr: ai_council_cost_usage_percentage > 0.8
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Cost limit warning"
          description: "Cost usage is {{ $value | humanizePercentage }} of the limit"

      - alert: TokenUsageSpike
        expr: rate(ai_council_tokens_total[5m]) > 10000
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "Unusual token usage spike"
          description: "Token usage rate is {{ $value }} tokens/second"
EOF
    
    print_success "Infrastructure monitoring configuration created"
}

# Deploy infrastructure
deploy_infrastructure() {
    print_status "Deploying production infrastructure..."
    
    # Check if production environment exists
    if [ ! -f ".env.production" ]; then
        print_error "Production environment file not found"
        print_status "Please configure .env.production first"
        return 1
    fi
    
    # Copy production environment
    cp .env.production .env
    
    # Build and deploy
    print_status "Building production images..."
    docker-compose -f docker-compose.prod.yml build
    
    print_status "Starting production services..."
    docker-compose -f docker-compose.prod.yml up -d
    
    # Wait for services to start
    print_status "Waiting for services to be ready..."
    sleep 30
    
    # Run database migrations
    print_status "Running database migrations..."
    docker-compose -f docker-compose.prod.yml exec -T app npx drizzle-kit push
    
    print_success "Production infrastructure deployed"
}

# Test infrastructure
test_infrastructure() {
    print_status "Testing production infrastructure..."
    
    local errors=0
    
    # Test application health
    if curl -f http://localhost:3000/health > /dev/null 2>&1; then
        print_success "Application health check passed"
    else
        print_error "Application health check failed"
        errors=$((errors + 1))
    fi
    
    # Test database connection
    if docker-compose -f docker-compose.prod.yml exec -T db pg_isready -U postgres > /dev/null 2>&1; then
        print_success "Database connection test passed"
    else
        print_error "Database connection test failed"
        errors=$((errors + 1))
    fi
    
    # Test Redis connection
    if docker-compose -f docker-compose.prod.yml exec -T redis redis-cli ping > /dev/null 2>&1; then
        print_success "Redis connection test passed"
    else
        print_error "Redis connection test failed"
        errors=$((errors + 1))
    fi
    
    # Test metrics endpoint
    if curl -f http://localhost:9090/metrics > /dev/null 2>&1; then
        print_success "Metrics endpoint test passed"
    else
        print_warning "Metrics endpoint test failed (may not be available yet)"
    fi
    
    if [ $errors -eq 0 ]; then
        print_success "Infrastructure test completed successfully"
    else
        print_error "Infrastructure test failed with $errors errors"
        return 1
    fi
}

# Show infrastructure status
show_infrastructure_status() {
    print_status "Production Infrastructure Status:"
    echo "====================================="
    
    docker-compose -f docker-compose.prod.yml ps
    
    echo ""
    echo "🌐 Access URLs:"
    echo "  Application: http://localhost:3000"
    echo "  Metrics: http://localhost:9090/metrics"
    echo "  Grafana: http://localhost:3001"
    echo "  Prometheus: http://localhost:9090"
    echo "  Alertmanager: http://localhost:9093"
    echo ""
    echo "📊 Resource Usage:"
    docker stats --no-stream --format "table {{.Container}}\t{{.CPUPerc}}\t{{.MemUsage}}\t{{.NetIO}}\t{{.BlockIO}}"
}

# Main execution
main() {
    print_status "Starting production infrastructure setup..."
    
    # Create all configurations
    create_production_docker_compose
    create_production_dockerfile
    create_production_nginx
    create_production_redis
    create_production_db_init
    create_production_env
    create_infrastructure_monitoring
    
    print_success "Production infrastructure configuration completed"
    echo ""
    echo "📋 Next Steps:"
    echo "  1. Configure .env.production with your values"
    echo "  2. Obtain SSL certificates and place in ssl/ directory"
    echo "  3. Run: ./scripts/setup-infrastructure.sh deploy"
    echo "  4. Test with: ./scripts/setup-infrastructure.sh test"
    echo ""
    echo "🚀 Quick Deploy:"
    echo "  cp .env.production .env"
    echo "  docker-compose -f docker-compose.prod.yml up -d"
    echo "  docker-compose -f docker-compose.prod.yml exec app npx drizzle-kit push"
}

# Handle command line arguments
case "${1:-all}" in
    "deploy")
        deploy_infrastructure
        ;;
    "test")
        test_infrastructure
        ;;
    "status")
        show_infrastructure_status
        ;;
    "restart")
        docker-compose -f docker-compose.prod.yml restart
        ;;
    "stop")
        docker-compose -f docker-compose.prod.yml down
        ;;
    "logs")
        docker-compose -f docker-compose.prod.yml logs -f "${2:-app}"
        ;;
    "all")
        main
        ;;
    *)
        echo "Usage: $0 {deploy|test|status|restart|stop|logs|all}"
        echo ""
        echo "Commands:"
        echo "  deploy   - Deploy production infrastructure"
        echo "  test     - Test infrastructure deployment"
        echo "  status   - Show infrastructure status"
        echo "  restart  - Restart all services"
        echo "  stop     - Stop all services"
        echo "  logs     - Show logs (usage: logs [service])"
        echo "  all      - Create all configurations (default)"
        exit 1
        ;;
esac
