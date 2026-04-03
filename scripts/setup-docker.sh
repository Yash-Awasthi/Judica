#!/bin/bash

# AI Council Docker Setup Script
# This script sets up Docker Compose for local development and testing

set -e

echo "🐳 AI Council Docker Setup"
echo "=========================="

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

# Check prerequisites
check_prerequisites() {
    print_status "Checking prerequisites..."
    
    # Check Docker
    if ! command -v docker &> /dev/null; then
        print_error "Docker is not installed"
        exit 1
    fi
    
    # Check Docker Compose
    if ! command -v docker-compose &> /dev/null && ! docker compose version &> /dev/null; then
        print_error "Docker Compose is not installed"
        exit 1
    fi
    
    # Check if docker-compose.yml exists
    if [ ! -f "docker-compose.yml" ] && [ ! -f "docker-compose.dev.yml" ]; then
        print_warning "Docker Compose file not found, creating..."
        create_docker_compose
    fi
    
    print_success "Prerequisites check completed"
}

# Create Docker Compose configuration
create_docker_compose() {
    print_status "Creating Docker Compose configuration..."
    
    cat > docker-compose.dev.yml << 'EOF'
version: '3.8'

services:
  app:
    build:
      context: .
      dockerfile: Dockerfile.dev
    ports:
      - "3000:3000"
      - "9090:9090"  # Metrics port
    environment:
      - NODE_ENV=development
      - DATABASE_URL=postgresql://postgres:password@db:5432/ai_council_dev
      - REDIS_URL=redis://redis:6379
      - JWT_SECRET=dev-jwt-secret-key
      - SESSION_SECRET=dev-session-secret-key
      - LOG_LEVEL=debug
      - METRICS_ENABLED=true
      - HEALTH_CHECKS_ENABLED=true
    volumes:
      - .:/app
      - /app/node_modules
      - ./logs:/app/logs
    depends_on:
      db:
        condition: service_healthy
      redis:
        condition: service_healthy
    restart: unless-stopped
    networks:
      - ai-council-network

  db:
    image: postgres:14-alpine
    environment:
      - POSTGRES_DB=ai_council_dev
      - POSTGRES_USER=postgres
      - POSTGRES_PASSWORD=password
    ports:
      - "5432:5432"
    volumes:
      - postgres_data:/var/lib/postgresql/data
      - ./scripts/init-db.sql:/docker-entrypoint-initdb.d/init-db.sql
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped
    networks:
      - ai-council-network

  redis:
    image: redis:7-alpine
    ports:
      - "6379:6379"
    volumes:
      - redis_data:/data
      - ./redis.conf:/usr/local/etc/redis/redis.conf
    command: redis-server /usr/local/etc/redis/redis.conf
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 10s
      timeout: 5s
      retries: 5
    restart: unless-stopped
    networks:
      - ai-council-network

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx/dev.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/nginx/ssl
    depends_on:
      - app
    restart: unless-stopped
    networks:
      - ai-council-network

  prometheus:
    image: prom/prometheus:latest
    ports:
      - "9091:9090"
    volumes:
      - ./monitoring/prometheus.yml:/etc/prometheus/prometheus.yml
      - prometheus_data:/prometheus
    command:
      - '--config.file=/etc/prometheus/prometheus.yml'
      - '--storage.tsdb.path=/prometheus'
      - '--web.console.libraries=/etc/prometheus/console_libraries'
      - '--web.console.templates=/etc/prometheus/consoles'
      - '--storage.tsdb.retention.time=200h'
      - '--web.enable-lifecycle'
    restart: unless-stopped
    networks:
      - ai-council-network

  grafana:
    image: grafana/grafana:latest
    ports:
      - "3001:3000"
    environment:
      - GF_SECURITY_ADMIN_PASSWORD=admin
      - GF_USERS_ALLOW_SIGN_UP=false
    volumes:
      - grafana_data:/var/lib/grafana
      - ./monitoring/grafana/provisioning:/etc/grafana/provisioning
      - ./monitoring/grafana/dashboards:/var/lib/grafana/dashboards
    depends_on:
      - prometheus
    restart: unless-stopped
    networks:
      - ai-council-network

volumes:
  postgres_data:
  redis_data:
  prometheus_data:
  grafana_data:

networks:
  ai-council-network:
    driver: bridge
EOF
    
    print_success "Docker Compose configuration created"
}

# Create Redis configuration
create_redis_config() {
    print_status "Creating Redis configuration..."
    
    cat > redis.conf << 'EOF'
# Redis Configuration for AI Council Development

# Network
bind 0.0.0.0
port 6379
timeout 0
tcp-keepalive 300

# Memory
maxmemory 256mb
maxmemory-policy allkeys-lru

# Persistence
save 900 1
save 300 10
save 60 10000

# Logging
loglevel notice
logfile ""

# Security
protected-mode no

# Performance
tcp-backlog 511
databases 16
always-show-logo yes
EOF
    
    print_success "Redis configuration created"
}

# Create Nginx configuration
create_nginx_config() {
    print_status "Creating Nginx configuration..."
    
    mkdir -p nginx
    
    cat > nginx/dev.conf << 'EOF'
events {
    worker_connections 1024;
}

http {
    upstream ai_council {
        server app:3000;
    }

    # Rate limiting
    limit_req_zone $binary_remote_addr zone=api:10m rate=10r/s;
    limit_req_zone $binary_remote_addr zone=auth:10m rate=5r/s;

    server {
        listen 80;
        server_name localhost;

        # Security headers
        add_header X-Frame-Options DENY;
        add_header X-Content-Type-Options nosniff;
        add_header X-XSS-Protection "1; mode=block";
        add_header Referrer-Policy strict-origin-when-cross-origin;

        # API endpoints with rate limiting
        location /api/ {
            limit_req zone=api burst=20 nodelay;
            proxy_pass http://ai_council;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
        }

        # Auth endpoints with stricter rate limiting
        location /api/auth/ {
            limit_req zone=auth burst=10 nodelay;
            proxy_pass http://ai_council;
            proxy_set_header Host $host;
            proxy_set_header X-Real-IP $remote_addr;
            proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
            proxy_set_header X-Forwarded-Proto $scheme;
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
        }

        # Static files
        location /static/ {
            proxy_pass http://ai_council;
            expires 1y;
            add_header Cache-Control "public, immutable";
        }

        # Health check
        location /health {
            proxy_pass http://ai_council;
            access_log off;
        }

        # Default route
        location / {
            proxy_pass http://ai_council;
        }
    }
}
EOF
    
    print_success "Nginx configuration created"
}

# Create monitoring configuration
create_monitoring_config() {
    print_status "Creating monitoring configuration..."
    
    mkdir -p monitoring/grafana/provisioning/datasources
    mkdir -p monitoring/grafana/provisioning/dashboards
    mkdir -p monitoring/grafana/dashboards
    
    # Prometheus configuration
    cat > monitoring/prometheus.yml << 'EOF'
global:
  scrape_interval: 15s
  evaluation_interval: 15s

rule_files:
  # - "first_rules.yml"
  # - "second_rules.yml"

scrape_configs:
  - job_name: 'ai-council'
    static_configs:
      - targets: ['app:9090']
    metrics_path: '/metrics'
    scrape_interval: 5s

  - job_name: 'postgres'
    static_configs:
      - targets: ['db:5432']
    metrics_path: '/metrics'
    scrape_interval: 10s

  - job_name: 'redis'
    static_configs:
      - targets: ['redis:6379']
    metrics_path: '/metrics'
    scrape_interval: 10s

  - job_name: 'nginx'
    static_configs:
      - targets: ['nginx:80']
    metrics_path: '/metrics'
    scrape_interval: 10s
EOF
    
    # Grafana datasource
    cat > monitoring/grafana/provisioning/datasources/prometheus.yml << 'EOF'
apiVersion: 1

datasources:
  - name: Prometheus
    type: prometheus
    access: proxy
    url: http://prometheus:9090
    isDefault: true
    editable: true
EOF
    
    print_success "Monitoring configuration created"
}

# Create development Dockerfile
create_dev_dockerfile() {
    print_status "Creating development Dockerfile..."
    
    cat > Dockerfile.dev << 'EOF'
FROM node:18-alpine

# Install dependencies
RUN apk add --no-cache \
    python3 \
    py3-pip \
    make \
    g++ \
    openssl \
    curl \
    bash

# Set working directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install dependencies
RUN npm ci --only=development

# Copy source code
COPY . .

# Generate Prisma client
RUN npx prisma generate

# Create logs directory
RUN mkdir -p logs

# Expose ports
EXPOSE 3000 9090

# Health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD curl -f http://localhost:3000/health || exit 1

# Start the application
CMD ["npm", "run", "dev"]
EOF
    
    print_success "Development Dockerfile created"
}

# Create database initialization script
create_db_init_script() {
    print_status "Creating database initialization script..."
    
    mkdir -p scripts
    
    cat > scripts/init-db.sql << 'EOF'
-- AI Council Database Initialization

-- Enable extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- Create indexes for better performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS "chat_created_at_idx" ON "Chat"("createdAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "chat_user_created_at_idx" ON "Chat"("userId", "createdAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "conversation_user_updated_at_idx" ON "Conversation"("userId", "updatedAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "audit_log_user_created_at_idx" ON "AuditLog"("userId", "createdAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "evaluation_user_timestamp_idx" ON "Evaluation"("userId", "timestamp");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "evaluation_session_idx" ON "Evaluation"("sessionId");

-- Update statistics
ANALYZE;

-- Log initialization
DO $$
BEGIN
    RAISE NOTICE 'AI Council database initialized successfully';
END
$$;
EOF
    
    print_success "Database initialization script created"
}

# Build Docker images
build_images() {
    print_status "Building Docker images..."
    
    docker-compose -f docker-compose.dev.yml build
    
    print_success "Docker images built"
}

# Start services
start_services() {
    print_status "Starting Docker services..."
    
    docker-compose -f docker-compose.dev.yml up -d
    
    print_success "Docker services started"
}

# Wait for services to be ready
wait_for_services() {
    print_status "Waiting for services to be ready..."
    
    # Wait for database
    print_status "Waiting for database..."
    timeout 60 bash -c 'until docker-compose -f docker-compose.dev.yml exec -T db pg_isready -U postgres; do sleep 2; done'
    
    # Wait for Redis
    print_status "Waiting for Redis..."
    timeout 60 bash -c 'until docker-compose -f docker-compose.dev.yml exec -T redis redis-cli ping; do sleep 2; done'
    
    # Wait for application
    print_status "Waiting for application..."
    timeout 120 bash -c 'until curl -f http://localhost:3000/health; do sleep 5; done'
    
    print_success "All services are ready"
}

# Run database migrations in Docker
run_migrations() {
    print_status "Running database migrations in Docker..."
    
    docker-compose -f docker-compose.dev.yml exec -T app npx prisma migrate deploy
    docker-compose -f docker-compose.dev.yml exec -T app npx prisma generate
    
    print_success "Database migrations completed"
}

# Test Docker setup
test_docker_setup() {
    print_status "Testing Docker setup..."
    
    # Test application health
    if curl -f http://localhost:3000/health > /dev/null; then
        print_success "Application health check passed"
    else
        print_error "Application health check failed"
        return 1
    fi
    
    # Test database connection
    if docker-compose -f docker-compose.dev.yml exec -T db pg_isready -U postgres > /dev/null; then
        print_success "Database connection test passed"
    else
        print_error "Database connection test failed"
        return 1
    fi
    
    # Test Redis connection
    if docker-compose -f docker-compose.dev.yml exec -T redis redis-cli ping > /dev/null; then
        print_success "Redis connection test passed"
    else
        print_error "Redis connection test failed"
        return 1
    fi
    
    # Test metrics endpoint
    if curl -f http://localhost:9090/metrics > /dev/null; then
        print_success "Metrics endpoint test passed"
    else
        print_warning "Metrics endpoint test failed (may not be available yet)"
    fi
    
    print_success "Docker setup test completed"
}

# Show service status
show_service_status() {
    print_status "Service Status:"
    echo "=================="
    
    docker-compose -f docker-compose.dev.yml ps
    
    echo ""
    echo "🌐 Access URLs:"
    echo "  Application: http://localhost:3000"
    echo "  Metrics: http://localhost:9090/metrics"
    echo "  Grafana: http://localhost:3001 (admin/admin)"
    echo "  Prometheus: http://localhost:9091"
    echo "  Database: localhost:5432 (postgres/password)"
    echo "  Redis: localhost:6379"
}

# Stop services
stop_services() {
    print_status "Stopping Docker services..."
    
    docker-compose -f docker-compose.dev.yml down
    
    print_success "Docker services stopped"
}

# Clean up Docker resources
cleanup_docker() {
    print_status "Cleaning up Docker resources..."
    
    docker-compose -f docker-compose.dev.yml down -v
    docker system prune -f
    
    print_success "Docker cleanup completed"
}

# Show logs
show_logs() {
    local service=${1:-app}
    
    print_status "Showing logs for $service..."
    docker-compose -f docker-compose.dev.yml logs -f "$service"
}

# Main execution
main() {
    print_status "Starting AI Council Docker setup..."
    
    # Execute setup steps
    check_prerequisites
    create_docker_compose
    create_redis_config
    create_nginx_config
    create_monitoring_config
    create_dev_dockerfile
    create_db_init_script
    build_images
    start_services
    wait_for_services
    run_migrations
    test_docker_setup
    show_service_status
    
    print_success "Docker setup completed successfully!"
    echo ""
    echo "🐳 Docker Summary:"
    echo "  - Docker Compose configured ✅"
    echo "  - All services started ✅"
    echo "  - Database migrations applied ✅"
    echo "  - Health checks passed ✅"
    echo "  - Monitoring configured ✅"
    echo ""
    echo "🌐 Access the application at: http://localhost:3000"
    echo "📊 View metrics at: http://localhost:9090/metrics"
    echo "📈 Grafana dashboard: http://localhost:3001"
    echo ""
    echo "🎉 Docker environment is ready for development!"
}

# Handle command line arguments
case "${1:-all}" in
    "build")
        build_images
        ;;
    "start")
        start_services
        wait_for_services
        ;;
    "stop")
        stop_services
        ;;
    "restart")
        stop_services
        start_services
        wait_for_services
        ;;
    "migrate")
        run_migrations
        ;;
    "test")
        test_docker_setup
        ;;
    "status")
        show_service_status
        ;;
    "logs")
        show_logs "$2"
        ;;
    "cleanup")
        cleanup_docker
        ;;
    "all")
        main
        ;;
    *)
        echo "Usage: $0 {build|start|stop|restart|migrate|test|status|logs|cleanup|all}"
        echo ""
        echo "Commands:"
        echo "  build     - Build Docker images"
        echo "  start     - Start all services"
        echo "  stop      - Stop all services"
        echo "  restart   - Restart all services"
        echo "  migrate   - Run database migrations"
        echo "  test      - Test Docker setup"
        echo "  status    - Show service status"
        echo "  logs      - Show logs (usage: logs [service])"
        echo "  cleanup   - Clean up Docker resources"
        echo "  all       - Run complete setup (default)"
        exit 1
        ;;
esac
