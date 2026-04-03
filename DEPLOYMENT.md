# 🚀 AI Council Deployment Guide

## 📋 Prerequisites

- Node.js 18+ 
- PostgreSQL 14+
- Redis 6+
- Docker & Docker Compose (optional)

## 🗄️ Database Setup

### PostgreSQL Setup

```bash
# Create database
createdb ai_council

# Run migrations
npx prisma migrate deploy

# Generate Prisma client
npx prisma generate
```

### Redis Setup

```bash
# Start Redis
redis-server

# Or with Docker
docker run -d -p 6379:6379 redis:alpine
```

## 🔑 Environment Variables

Create `.env` file:

```env
# Database
DATABASE_URL="postgresql://username:password@localhost:5432/ai_council"

# Redis
REDIS_URL="redis://localhost:6379"

# AI Provider Keys
OPENAI_API_KEY="sk-..."
ANTHROPIC_API_KEY="..."
GOOGLE_API_KEY="..."

# Security
JWT_SECRET="your-secret-key"
SESSION_SECRET="your-session-secret"

# Frontend
FRONTEND_URL="http://localhost:3000"

# Local AI (Optional)
OLLAMA_ENDPOINT="http://localhost:11434"
LM_STUDIO_ENDPOINT="http://localhost:1234"

# Cost Limits (Optional)
DEFAULT_DAILY_LIMIT="10.0"
DEFAULT_MONTHLY_LIMIT="100.0"

# Monitoring
LOG_LEVEL="info"
METRICS_ENABLED="true"
```

## 🧪 Testing & Benchmarks

### Run Test Suite

```bash
# Unit tests
npm test

# Integration tests
npm run test:integration

# Benchmarks
npm run test:benchmark

# Coverage
npm run test:coverage
```

### Performance Benchmarks

```bash
# Council deliberation benchmarks
npm run benchmark:council

# PII detection benchmarks
npm run benchmark:pii

# Cost tracking benchmarks
npm run benchmark:cost
```

## 🚀 Production Deployment

### Infrastructure Setup

#### Docker Compose (Recommended)

```yaml
# docker-compose.prod.yml
version: '3.8'
services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - DATABASE_URL=postgresql://postgres:password@db:5432/ai_council
      - REDIS_URL=redis://redis:6379
    depends_on:
      - db
      - redis
    restart: unless-stopped

  db:
    image: postgres:14
    environment:
      POSTGRES_DB: ai_council
      POSTGRES_USER: postgres
      POSTGRES_PASSWORD: password
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

  redis:
    image: redis:alpine
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
    depends_on:
      - app
    restart: unless-stopped

volumes:
  postgres_data:
```

#### SSL Configuration

```nginx
# nginx.conf
server {
    listen 443 ssl http2;
    server_name your-domain.com;

    ssl_certificate /etc/nginx/ssl/cert.pem;
    ssl_certificate_key /etc/nginx/ssl/key.pem;

    location / {
        proxy_pass http://app:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

server {
    listen 80;
    server_name your-domain.com;
    return 301 https://$server_name$request_uri;
}
```

### Security Configuration

#### Authentication
- JWT tokens with proper expiration
- Rate limiting per user
- API key rotation policies
- Session management

#### Access Control
```bash
# Create admin user
npm run create-admin --username admin --email admin@domain.com

# Set user roles
npm run set-role --username user --role "user"
npm run set-role --username admin --role "admin"
```

#### Firewall Rules
```bash
# Database access (only from app)
ufw allow from app_ip to any port 5432

# Redis access (only from app)
ufw allow from app_ip to any port 6379

# Web access
ufw allow 80/tcp
ufw allow 443/tcp
```

## 📊 Monitoring Setup

### Application Monitoring

```bash
# Install monitoring dependencies
npm install @prometheus/client grafana

# Configure metrics
export METRICS_ENABLED=true
export METRICS_PORT=9090
```

### Health Checks

```bash
# Application health
curl http://localhost:3000/health

# Database health
curl http://localhost:3000/health/db

# Redis health
curl http://localhost:3000/health/redis
```

### Logging

```bash
# Configure structured logging
export LOG_LEVEL=info
export LOG_FORMAT=json

# Log rotation
logrotate -f /etc/logrotate.d/ai-council
```

## 🔧 Scaling Configuration

### Load Balancing

```nginx
upstream ai_council {
    server app1:3000;
    server app2:3000;
    server app3:3000;
}

server {
    location / {
        proxy_pass http://ai_council;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### Auto-scaling (Kubernetes)

```yaml
# k8s-deployment.yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: ai-council
spec:
  replicas: 3
  selector:
    matchLabels:
      app: ai-council
  template:
    metadata:
      labels:
        app: ai-council
    spec:
      containers:
      - name: ai-council
        image: ai-council:latest
        ports:
        - containerPort: 3000
        env:
        - name: NODE_ENV
          value: "production"
        resources:
          requests:
            memory: "512Mi"
            cpu: "250m"
          limits:
            memory: "1Gi"
            cpu: "500m"
---
apiVersion: autoscaling/v2
kind: HorizontalPodAutoscaler
metadata:
  name: ai-council-hpa
spec:
  scaleTargetRef:
    apiVersion: apps/v1
    kind: Deployment
    name: ai-council
  minReplicas: 2
  maxReplicas: 10
  metrics:
  - type: Resource
    resource:
      name: cpu
      target:
        type: Utilization
        averageUtilization: 70
  - type: Resource
    resource:
      name: memory
      target:
        type: Utilization
        averageUtilization: 80
```

## 🔍 Local AI Setup

### Ollama Setup

```bash
# Install Ollama
curl -fsSL https://ollama.ai/install.sh | sh

# Pull models
ollama pull llama2
ollama pull codellama
ollama pull mistral

# Start server
ollama serve
```

### LM Studio Setup

1. Download LM Studio
2. Load preferred models
3. Start server on port 1234
4. Configure in environment:
```env
LM_STUDIO_ENDPOINT="http://localhost:1234"
```

### llama.cpp Setup

```bash
# Build llama.cpp
git clone https://github.com/ggerganov/llama.cpp
cd llama.cpp
make

# Download model
wget https://huggingface.co/TheBloke/Llama-2-7B-GGUF/resolve/main/llama-2-7b.Q4_K_M.gguf

# Start server
./main -m llama-2-7b.Q4_K_M.gguf --host 0.0.0.0 --port 8080
```

## 📱 Desktop App Integration

### Obsidian Integration

```bash
# Install Obsidian Local API plugin
# Settings → Third-party plugin → Community plugins → Browse → "Local REST API"

# Configure in AI Council
export OBSIDIAN_ENDPOINT="http://localhost:42424"
```

### VS Code Integration

```bash
# Install AI Council extension
code --install-extension ai-council.vscode-extension

# Configure workspace
export VSCODE_ENDPOINT="http://localhost:3000"
```

### Notion Integration

```bash
# Create Notion integration
# 1. Go to notion.dev/create-integration
# 2. Create new integration
# 3. Get API key
# 4. Share pages with integration

# Configure in environment
export NOTION_API_KEY="secret_..."
export NOTION_VERSION="2022-06-28"
```

## 🚨 Troubleshooting

### Common Issues

#### Database Connection
```bash
# Check PostgreSQL status
sudo systemctl status postgresql

# Test connection
psql -h localhost -U username -d ai_council

# Reset migrations
npx prisma migrate reset
```

#### Redis Connection
```bash
# Check Redis status
redis-cli ping

# Monitor Redis
redis-cli monitor
```

#### Memory Issues
```bash
# Check memory usage
free -h
docker stats

# Increase Node.js memory
export NODE_OPTIONS="--max-old-space-size=4096"
```

#### Performance Issues
```bash
# Profile application
npm run profile

# Check database queries
npx prisma studio

# Monitor Redis
redis-cli info memory
```

### Health Monitoring

```bash
# Create health check script
cat > health-check.sh << 'EOF'
#!/bin/bash

echo "=== AI Council Health Check ==="

# Application health
if curl -f http://localhost:3000/health > /dev/null 2>&1; then
    echo "✅ Application: Healthy"
else
    echo "❌ Application: Unhealthy"
fi

# Database health
if curl -f http://localhost:3000/health/db > /dev/null 2>&1; then
    echo "✅ Database: Healthy"
else
    echo "❌ Database: Unhealthy"
fi

# Redis health
if curl -f http://localhost:3000/health/redis > /dev/null 2>&1; then
    echo "✅ Redis: Healthy"
else
    echo "❌ Redis: Unhealthy"
fi

echo "=== End Health Check ==="
EOF

chmod +x health-check.sh
./health-check.sh
```

## 📈 Performance Optimization

### Database Optimization

```sql
-- Create indexes for performance
CREATE INDEX CONCURRENTLY "chat_created_at_idx" ON "Chat"("createdAt");
CREATE INDEX CONCURRENTLY "audit_log_user_created_idx" ON "AuditLog"("userId", "createdAt");
CREATE INDEX CONCURRENTLY "evaluation_session_idx" ON "Evaluation"("sessionId");

-- Analyze table statistics
ANALYZE;

-- Check query performance
EXPLAIN ANALYZE SELECT * FROM "Chat" WHERE "userId" = $1 ORDER BY "createdAt" DESC LIMIT 50;
```

### Caching Strategy

```bash
# Redis configuration optimization
redis-cli CONFIG SET maxmemory 2gb
redis-cli CONFIG SET maxmemory-policy allkeys-lru

# Application caching
export CACHE_TTL=3600
export CACHE_MAX_SIZE=1000
```

### CDN Setup

```nginx
# Static file caching
location /static/ {
    expires 1y;
    add_header Cache-Control "public, immutable";
}

# API response caching
location /api/ {
    proxy_cache api_cache;
    proxy_cache_valid 200 5m;
    proxy_cache_key "$scheme$request_method$host$request_uri";
}
```

## 🔄 Backup & Recovery

### Database Backup

```bash
# Create backup script
cat > backup-db.sh << 'EOF'
#!/bin/bash

BACKUP_DIR="/backups/ai-council"
DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="$BACKUP_DIR/backup_$DATE.sql"

mkdir -p $BACKUP_DIR

pg_dump ai_council > $BACKUP_FILE

# Compress backup
gzip $BACKUP_FILE

# Keep only last 7 days
find $BACKUP_DIR -name "*.sql.gz" -mtime +7 -delete

echo "Backup completed: $BACKUP_FILE.gz"
EOF

chmod +x backup-db.sh

# Schedule daily backups
echo "0 2 * * * /path/to/backup-db.sh" | crontab -
```

### Redis Backup

```bash
# Configure Redis persistence
redis-cli CONFIG SET save "900 1 300 10 60 10000"

# Manual backup
redis-cli BGSAVE
cp /var/lib/redis/dump.rdb /backups/redis_$(date +%Y%m%d_%H%M%S).rdb
```

## 📞 Support & Maintenance

### Regular Maintenance Tasks

```bash
# Weekly maintenance script
cat > maintenance.sh << 'EOF'
#!/bin/bash

echo "=== Weekly Maintenance ==="

# Clean old audit logs
npm run cleanup:audit-logs --days=90

# Optimize database
psql ai_council -c "VACUUM ANALYZE;"

# Clear Redis cache
redis-cli FLUSHDB

# Update dependencies
npm update

# Restart services
systemctl restart ai-council

echo "=== Maintenance Complete ==="
EOF

chmod +x maintenance.sh

# Schedule weekly maintenance
echo "0 3 * * 0 /path/to/maintenance.sh" | crontab -
```

### Monitoring Alerts

```bash
# Set up monitoring alerts
# 1. High error rate
# 2. High memory usage
# 3. Database connection issues
# 4. Redis connection issues
# 5. Cost limit warnings
```

---

## 🎉 Deployment Complete!

Your AI Council is now production-ready with:
- ✅ Complete database schema and migrations
- ✅ Environment configuration
- ✅ Security and monitoring setup
- ✅ Scaling and backup strategies
- ✅ Local AI and desktop app integration

The system is ready to handle enterprise workloads with full observability and compliance features.
