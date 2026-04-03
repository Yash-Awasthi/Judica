#!/bin/bash

# AI Council Production Monitoring Setup
# This script sets up comprehensive monitoring, logging, and alerting

set -e

echo "📊 AI Council Production Monitoring Setup"
echo "======================================"

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

# Create monitoring configuration
create_monitoring_config() {
    print_status "Creating monitoring configuration..."
    
    mkdir -p monitoring/{rules,dashboards,alerts,logs}
    
    # Enhanced Prometheus configuration
    cat > monitoring/prometheus-prod.yml << 'EOF'
global:
  scrape_interval: 15s
  evaluation_interval: 15s
  external_labels:
    cluster: 'production'
    replica: 'prod-1'
    region: 'us-west-2'

rule_files:
  - "rules/*.yml"

alerting:
  alertmanagers:
    - static_configs:
        - targets:
          - alertmanager:9093
      timeout: 10s
      api_version: v2

scrape_configs:
  - job_name: 'ai-council'
    static_configs:
      - targets: ['app:3000']
    metrics_path: '/metrics'
    scrape_interval: 5s
    scrape_timeout: 10s
    honor_labels: true
    params:
      format: ['prometheus']

  - job_name: 'nginx'
    static_configs:
      - targets: ['nginx:80']
    metrics_path: '/metrics'
    scrape_interval: 10s
    scrape_timeout: 5s

  - job_name: 'postgres'
    static_configs:
      - targets: ['postgres-exporter:9187']
    scrape_interval: 10s
    scrape_timeout: 5s

  - job_name: 'redis'
    static_configs:
      - targets: ['redis-exporter:9121']
    scrape_interval: 10s
    scrape_timeout: 5s

  - job_name: 'node-exporter'
    static_configs:
      - targets: ['node-exporter:9100']
    scrape_interval: 10s
    scrape_timeout: 5s

  - job_name: 'prometheus'
    static_configs:
      - targets: ['localhost:9090']
    scrape_interval: 30s

  - job_name: 'docker'
    static_configs:
      - targets: ['docker-exporter:9323']
    scrape_interval: 15s

remote_write:
  - url: "https://your-remote-prometheus.com/api/v1/write"
    basic_auth:
      username: "user"
      password: "password"
    queue_config:
      max_samples_per_send: 1000
      max_shards: 200
      capacity: 2500

storage:
  tsdb:
    retention.time: 30d
    retention.size: 10GB
    wal.compression: true
    wal.max_segment_size.bytes: 20MB
EOF
    
    print_success "Monitoring configuration created"
}

# Create comprehensive alerting rules
create_alerting_rules() {
    print_status "Creating comprehensive alerting rules..."
    
    cat > monitoring/rules/ai-council-comprehensive.yml << 'EOF'
groups:
  - name: ai-council.application
    rules:
      - alert: HighErrorRate
        expr: rate(http_requests_total{status=~"5.."}[5m]) / rate(http_requests_total[5m]) > 0.05
        for: 5m
        labels:
          severity: critical
          service: ai-council
          component: application
        annotations:
          summary: "High error rate detected"
          description: "Error rate is {{ $value | humanizePercentage }} for the last 5 minutes"
          runbook_url: "https://docs.ai-council.com/runbooks/high-error-rate"

      - alert: HighResponseTime
        expr: histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m])) > 2
        for: 5m
        labels:
          severity: warning
          service: ai-council
          component: application
        annotations:
          summary: "High response time detected"
          description: "95th percentile response time is {{ $value }}s"

      - alert: LowThroughput
        expr: rate(http_requests_total[5m]) < 10
        for: 10m
        labels:
          severity: warning
          service: ai-council
          component: application
        annotations:
          summary: "Low throughput detected"
          description: "Request rate is {{ $value }} requests/second"

      - alert: ApplicationDown
        expr: up{job="ai-council"} == 0
        for: 1m
        labels:
          severity: critical
          service: ai-council
          component: application
        annotations:
          summary: "AI Council application is down"
          description: "The AI Council application has been down for more than 1 minute"

  - name: ai-council.database
    rules:
      - alert: DatabaseConnectionFailure
        expr: up{job="postgres"} == 0
        for: 1m
        labels:
          severity: critical
          service: ai-council
          component: database
        annotations:
          summary: "Database connection failure"
          description: "PostgreSQL database is down"

      - alert: DatabaseSlowQueries
        expr: pg_stat_statements_mean_time_seconds > 1
        for: 5m
        labels:
          severity: warning
          service: ai-council
          component: database
        annotations:
          summary: "Database slow queries detected"
          description: "Average query time is {{ $value }}s"

      - alert: DatabaseHighConnections
        expr: pg_stat_activity_count > 80
        for: 5m
        labels:
          severity: warning
          service: ai-council
          component: database
        annotations:
          summary: "High database connections"
          description: "Database has {{ $value }} active connections"

      - alert: DatabaseDiskSpaceLow
        expr: (pg_database_size_bytes / 1024 / 1024 / 1024) > 50
        for: 10m
        labels:
          severity: warning
          service: ai-council
          component: database
        annotations:
          summary: "Database disk space low"
          description: "Database size is {{ $value }}GB"

  - name: ai-council.cache
    rules:
      - alert: RedisConnectionFailure
        expr: up{job="redis"} == 0
        for: 1m
        labels:
          severity: critical
          service: ai-council
          component: cache
        annotations:
          summary: "Redis connection failure"
          description: "Redis cache is down"

      - alert: RedisHighMemoryUsage
        expr: redis_memory_used_bytes / redis_memory_max_bytes > 0.8
        for: 5m
        labels:
          severity: warning
          service: ai-council
          component: cache
        annotations:
          summary: "Redis high memory usage"
          description: "Redis memory usage is {{ $value | humanizePercentage }}"

      - alert: RedisHighKeyCount
        expr: redis_db_keys > 1000000
        for: 10m
        labels:
          severity: warning
          service: ai-council
          component: cache
        annotations:
          summary: "Redis high key count"
          description: "Redis has {{ $value }} keys"

  - name: ai-council.infrastructure
    rules:
      - alert: HighMemoryUsage
        expr: (node_memory_MemTotal_bytes - node_memory_MemAvailable_bytes) / node_memory_MemTotal_bytes > 0.8
        for: 5m
        labels:
          severity: warning
          service: ai-council
          component: infrastructure
        annotations:
          summary: "High memory usage"
          description: "Memory usage is {{ $value | humanizePercentage }}"

      - alert: HighCPUUsage
        expr: 100 - (avg by(instance) (irate(node_cpu_seconds_total{mode="idle"}[5m])) * 100) > 80
        for: 5m
        labels:
          severity: warning
          service: ai-council
          component: infrastructure
        annotations:
          summary: "High CPU usage"
          description: "CPU usage is {{ $value }}%"

      - alert: DiskSpaceLow
        expr: (node_filesystem_avail_bytes / node_filesystem_size_bytes) < 0.1
        for: 5m
        labels:
          severity: critical
          service: ai-council
          component: infrastructure
        annotations:
          summary: "Low disk space"
          description: "Disk space is {{ $value | humanizePercentage }}"

      - alert: NetworkHighTraffic
        expr: rate(node_network_receive_bytes_total[5m]) + rate(node_network_transmit_bytes_total[5m]) > 100000000
        for: 5m
        labels:
          severity: warning
          service: ai-council
          component: infrastructure
        annotations:
          summary: "High network traffic"
          description: "Network traffic is {{ $value | humanizeBytes }}/s"

  - name: ai-council.cost
    rules:
      - alert: CostLimitWarning
        expr: ai_council_cost_usage_percentage > 0.8
        for: 5m
        labels:
          severity: warning
          service: ai-council
          component: cost
        annotations:
          summary: "Cost limit warning"
          description: "Cost usage is {{ $value | humanizePercentage }} of the limit"

      - alert: CostLimitCritical
        expr: ai_council_cost_usage_percentage > 0.95
        for: 1m
        labels:
          severity: critical
          service: ai-council
          component: cost
        annotations:
          summary: "Cost limit critical"
          description: "Cost usage is {{ $value | humanizePercentage }} of the limit"

      - alert: UnusualTokenUsageSpike
        expr: rate(ai_council_tokens_total[5m]) > 10000
        for: 2m
        labels:
          severity: warning
          service: ai-council
          component: cost
        annotations:
          summary: "Unusual token usage spike"
          description: "Token usage rate is {{ $value }} tokens/second"

  - name: ai-council.security
    rules:
      - alert: HighFailedLogins
        expr: rate(ai_council_failed_logins_total[5m]) > 10
        for: 2m
        labels:
          severity: warning
          service: ai-council
          component: security
        annotations:
          summary: "High failed login attempts"
          description: "Failed login rate is {{ $value }} attempts/second"

      - alert: SuspiciousAPIUsage
        expr: rate(ai_council_api_requests_total[5m]) > 1000
        for: 5m
        labels:
          severity: warning
          service: ai-council
          component: security
        annotations:
          summary: "Suspicious API usage"
          description: "API request rate is {{ $value }} requests/second"

      - alert: PIIDetectionSpike
        expr: rate(ai_council_pii_detected_total[5m]) > 5
        for: 5m
        labels:
          severity: warning
          service: ai-council
          component: security
        annotations:
          summary: "PII detection spike"
          description: "PII detection rate is {{ $value }} detections/second"
EOF
    
    print_success "Alerting rules created"
}

# Create Grafana dashboards
create_grafana_dashboards() {
    print_status "Creating Grafana dashboards..."
    
    # Main dashboard
    cat > monitoring/dashboards/ai-council-main.json << 'EOF'
{
  "dashboard": {
    "id": null,
    "title": "AI Council - Main Dashboard",
    "tags": ["ai-council", "main"],
    "timezone": "browser",
    "panels": [
      {
        "id": 1,
        "title": "Request Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(http_requests_total[5m])",
            "legendFormat": "{{method}} {{status}}"
          }
        ],
        "gridPos": {"h": 8, "w": 12, "x": 0, "y": 0},
        "yAxes": [{"label": "Requests/sec"}]
      },
      {
        "id": 2,
        "title": "Response Time",
        "type": "graph",
        "targets": [
          {
            "expr": "histogram_quantile(0.50, rate(http_request_duration_seconds_bucket[5m]))",
            "legendFormat": "50th percentile"
          },
          {
            "expr": "histogram_quantile(0.95, rate(http_request_duration_seconds_bucket[5m]))",
            "legendFormat": "95th percentile"
          },
          {
            "expr": "histogram_quantile(0.99, rate(http_request_duration_seconds_bucket[5m]))",
            "legendFormat": "99th percentile"
          }
        ],
        "gridPos": {"h": 8, "w": 12, "x": 12, "y": 0},
        "yAxes": [{"label": "Seconds"}]
      },
      {
        "id": 3,
        "title": "Error Rate",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(http_requests_total{status=~\"5..\"}[5m]) / rate(http_requests_total[5m])",
            "legendFormat": "Error Rate"
          }
        ],
        "gridPos": {"h": 8, "w": 12, "x": 0, "y": 8},
        "yAxes": [{"label": "Percentage", "max": 1, "min": 0}]
      },
      {
        "id": 4,
        "title": "Active Users",
        "type": "stat",
        "targets": [
          {
            "expr": "ai_council_active_users_total",
            "legendFormat": "Active Users"
          }
        ],
        "gridPos": {"h": 8, "w": 12, "x": 12, "y": 8},
        "fieldConfig": {"defaults": {"unit": "short"}}
      },
      {
        "id": 5,
        "title": "Database Connections",
        "type": "graph",
        "targets": [
          {
            "expr": "pg_stat_activity_count",
            "legendFormat": "Active Connections"
          }
        ],
        "gridPos": {"h": 8, "w": 12, "x": 0, "y": 16},
        "yAxes": [{"label": "Connections"}]
      },
      {
        "id": 6,
        "title": "Redis Memory Usage",
        "type": "graph",
        "targets": [
          {
            "expr": "redis_memory_used_bytes / 1024 / 1024",
            "legendFormat": "Memory (MB)"
          }
        ],
        "gridPos": {"h": 8, "w": 12, "x": 12, "y": 16},
        "yAxes": [{"label": "MB"}]
      }
    ],
    "time": {"from": "now-1h", "to": "now"},
    "refresh": "30s"
  }
}
EOF
    
    # Cost tracking dashboard
    cat > monitoring/dashboards/ai-council-cost.json << 'EOF'
{
  "dashboard": {
    "id": null,
    "title": "AI Council - Cost Tracking",
    "tags": ["ai-council", "cost"],
    "timezone": "browser",
    "panels": [
      {
        "id": 1,
        "title": "Daily Cost",
        "type": "graph",
        "targets": [
          {
            "expr": "ai_council_cost_daily_total",
            "legendFormat": "Daily Cost"
          }
        ],
        "gridPos": {"h": 8, "w": 12, "x": 0, "y": 0},
        "yAxes": [{"label": "USD"}]
      },
      {
        "id": 2,
        "title": "Token Usage",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(ai_council_tokens_total[5m]) * 300",
            "legendFormat": "Tokens/5min"
          }
        ],
        "gridPos": {"h": 8, "w": 12, "x": 12, "y": 0},
        "yAxes": [{"label": "Tokens"}]
      },
      {
        "id": 3,
        "title": "Cost by Provider",
        "type": "piechart",
        "targets": [
          {
            "expr": "ai_council_cost_by_provider",
            "legendFormat": "{{provider}}"
          }
        ],
        "gridPos": {"h": 8, "w": 12, "x": 0, "y": 8}
      },
      {
        "id": 4,
        "title": "Cost per User",
        "type": "table",
        "targets": [
          {
            "expr": "ai_council_cost_per_user",
            "legendFormat": "{{user_id}}"
          }
        ],
        "gridPos": {"h": 8, "w": 12, "x": 12, "y": 8}
      }
    ],
    "time": {"from": "now-7d", "to": "now"},
    "refresh": "1m"
  }
}
EOF
    
    # Security dashboard
    cat > monitoring/dashboards/ai-council-security.json << 'EOF'
{
  "dashboard": {
    "id": null,
    "title": "AI Council - Security",
    "tags": ["ai-council", "security"],
    "timezone": "browser",
    "panels": [
      {
        "id": 1,
        "title": "Failed Login Attempts",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(ai_council_failed_logins_total[5m])",
            "legendFormat": "Failed Logins/sec"
          }
        ],
        "gridPos": {"h": 8, "w": 12, "x": 0, "y": 0},
        "yAxes": [{"label": "Attempts/sec"}]
      },
      {
        "id": 2,
        "title": "PII Detections",
        "type": "graph",
        "targets": [
          {
            "expr": "rate(ai_council_pii_detected_total[5m])",
            "legendFormat": "PII Detections/sec"
          }
        ],
        "gridPos": {"h": 8, "w": 12, "x": 12, "y": 0},
        "yAxes": [{"label": "Detections/sec"}]
      },
      {
        "id": 3,
        "title": "Security Events",
        "type": "table",
        "targets": [
          {
            "expr": "ai_council_security_events_total",
            "legendFormat": "{{event_type}}"
          }
        ],
        "gridPos": {"h": 8, "w": 24, "x": 0, "y": 8}
      }
    ],
    "time": {"from": "now-24h", "to": "now"},
    "refresh": "30s"
  }
}
EOF
    
    print_success "Grafana dashboards created"
}

# Create logging configuration
create_logging_config() {
    print_status "Creating logging configuration..."
    
    # Create log rotation configuration
    cat > monitoring/logrotate.conf << 'EOF'
# AI Council Log Rotation Configuration

# Application logs
/logs/app/*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    create 644 nodejs nodejs
    postrotate
        docker-compose -f docker-compose.prod.yml restart app
    endscript
}

# Nginx logs
/logs/nginx/*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    create 644 nginx nginx
    postrotate
        docker-compose -f docker-compose.prod.yml exec nginx nginx -s reload
    endscript
}

# Database logs
/logs/postgres/*.log {
    weekly
    missingok
    rotate 4
    compress
    delaycompress
    notifempty
    create 644 postgres postgres
    postrotate
        docker-compose -f docker-compose.prod.yml restart db
    endscript
}

# System logs
/logs/system/*.log {
    daily
    missingok
    rotate 7
    compress
    delaycompress
    notifempty
    create 644 root root
}
EOF
    
    # Create logging configuration for the application
    cat > config/logging.json << 'EOF'
{
  "version": 1,
  "disable_existing_loggers": false,
  "formatters": {
    "default": {
      "format": "%(asctime)s - %(name)s - %(levelname)s - %(message)s"
    },
    "json": {
      "format": "%(asctime)s %(name)s %(levelname)s %(message)s",
      "class": "pythonjsonlogger.jsonlogger.JsonFormatter"
    },
    "detailed": {
      "format": "%(asctime)s - %(name)s - %(levelname)s - %(filename)s:%(lineno)d - %(message)s"
    }
  },
  "handlers": {
    "console": {
      "class": "logging.StreamHandler",
      "level": "INFO",
      "formatter": "default",
      "stream": "ext://sys.stdout"
    },
    "file": {
      "class": "logging.handlers.RotatingFileHandler",
      "level": "INFO",
      "formatter": "json",
      "filename": "/app/logs/app.log",
      "maxBytes": 10485760,
      "backupCount": 5
    },
    "error_file": {
      "class": "logging.handlers.RotatingFileHandler",
      "level": "ERROR",
      "formatter": "detailed",
      "filename": "/app/logs/error.log",
      "maxBytes": 10485760,
      "backupCount": 5
    },
    "access_file": {
      "class": "logging.handlers.RotatingFileHandler",
      "level": "INFO",
      "formatter": "json",
      "filename": "/app/logs/access.log",
      "maxBytes": 10485760,
      "backupCount": 5
    }
  },
  "loggers": {
    "": {
      "level": "INFO",
      "handlers": ["console", "file"]
    },
    "error": {
      "level": "ERROR",
      "handlers": ["error_file"],
      "propagate": false
    },
    "access": {
      "level": "INFO",
      "handlers": ["access_file"],
      "propagate": false
    },
    "security": {
      "level": "WARNING",
      "handlers": ["console", "file"],
      "propagate": true
    },
    "audit": {
      "level": "INFO",
      "handlers": ["file"],
      "propagate": false
    }
  }
}
EOF
    
    print_success "Logging configuration created"
}

# Create health check endpoints
create_health_checks() {
    print_status "Creating comprehensive health checks..."
    
    cat > scripts/health-check.sh << 'EOF'
#!/bin/bash

# AI Council Health Check Script

BASE_URL="http://localhost:3000"
TIMEOUT=10
VERBOSE=false

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Parse arguments
while [[ $# -gt 0 ]]; do
  case $1 in
    -v|--verbose)
      VERBOSE=true
      shift
      ;;
    -u|--url)
      BASE_URL="$2"
      shift 2
      ;;
    -t|--timeout)
      TIMEOUT="$2"
      shift 2
      ;;
    *)
      echo "Unknown option $1"
      exit 1
      ;;
  esac
done

# Health check function
check_health() {
    local endpoint="$1"
    local expected_status="${2:-200}"
    local description="$3"
    
    if [ "$VERBOSE" = true ]; then
        echo "Checking $endpoint..."
    fi
    
    local response=$(curl -s -w "%{http_code}" -o /tmp/health_check_response --max-time "$TIMEOUT" "$BASE_URL$endpoint")
    local status_code="${response: -3}"
    
    if [ "$status_code" = "$expected_status" ]; then
        echo -e "${GREEN}✅ $description${NC}"
        if [ "$VERBOSE" = true ]; then
            cat /tmp/health_check_response
            echo ""
        fi
        return 0
    else
        echo -e "${RED}❌ $description (HTTP $status_code)${NC}"
        if [ "$VERBOSE" = true ]; then
            cat /tmp/health_check_response
            echo ""
        fi
        return 1
    fi
}

# Check application health
echo "🏥 AI Council Health Check"
echo "========================"

checks_passed=0
total_checks=0

# Basic health check
total_checks=$((total_checks + 1))
if check_health "/health" "200" "Application Health"; then
    checks_passed=$((checks_passed + 1))
fi

# API endpoints
total_checks=$((total_checks + 1))
if check_health "/api/costs/breakdown?days=1" "200" "API Cost Endpoint"; then
    checks_passed=$((checks_passed + 1))
fi

total_checks=$((total_checks + 1))
if check_health "/api/evaluation/metrics?days=1" "200" "API Evaluation Endpoint"; then
    checks_passed=$((checks_passed + 1))
fi

total_checks=$((total_checks + 1))
if check_health "/api/history/search?q=test&scope=all&page=1&limit=5" "200" "API Search Endpoint"; then
    checks_passed=$((checks_passed + 1))
fi

# Metrics endpoint
total_checks=$((total_checks + 1))
if check_health "/metrics" "200" "Metrics Endpoint"; then
    checks_passed=$((checks_passed + 1))
fi

# Database health (if accessible)
total_checks=$((total_checks + 1))
if docker-compose -f docker-compose.prod.yml exec -T db pg_isready -U postgres > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Database Health${NC}"
    checks_passed=$((checks_passed + 1))
else
    echo -e "${RED}❌ Database Health${NC}"
fi

# Redis health (if accessible)
total_checks=$((total_checks + 1))
if docker-compose -f docker-compose.prod.yml exec -T redis redis-cli ping > /dev/null 2>&1; then
    echo -e "${GREEN}✅ Redis Health${NC}"
    checks_passed=$((checks_passed + 1))
else
    echo -e "${RED}❌ Redis Health${NC}"
fi

# Summary
echo ""
echo "📊 Health Check Summary:"
echo "  Checks Passed: $checks_passed/$total_checks"

if [ $checks_passed -eq $total_checks ]; then
    echo -e "${GREEN}🎉 All health checks passed!${NC}"
    exit 0
else
    echo -e "${RED}⚠️  Some health checks failed${NC}"
    exit 1
fi
EOF
    
    chmod +x scripts/health-check.sh
    
    print_success "Health check script created"
}

# Create monitoring startup script
create_monitoring_startup() {
    print_status "Creating monitoring startup script..."
    
    cat > scripts/start-monitoring.sh << 'EOF'
#!/bin/bash

# AI Council Monitoring Startup Script

echo "📊 Starting AI Council Monitoring Stack"
echo "====================================="

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Function to check if service is running
check_service() {
    local service="$1"
    local container="$2"
    
    if docker-compose -f docker-compose.prod.yml ps "$container" | grep -q "Up"; then
        echo -e "${GREEN}✅ $service is running${NC}"
        return 0
    else
        echo -e "${RED}❌ $service is not running${NC}"
        return 1
    fi
}

# Function to start service
start_service() {
    local service="$1"
    local container="$2"
    
    echo "Starting $service..."
    docker-compose -f docker-compose.prod.yml up -d "$container"
    
    # Wait for service to be ready
    local attempts=0
    local max_attempts=30
    
    while [ $attempts -lt $max_attempts ]; do
        if check_service "$service" "$container"; then
            echo -e "${GREEN}✅ $service started successfully${NC}"
            return 0
        fi
        
        echo "Waiting for $service to start... ($((attempts + 1))/$max_attempts)"
        sleep 2
        attempts=$((attempts + 1))
    done
    
    echo -e "${RED}❌ $service failed to start${NC}"
    return 1
}

# Check prerequisites
echo "Checking prerequisites..."

if ! docker-compose -f docker-compose.prod.yml ps > /dev/null 2>&1; then
    echo -e "${RED}❌ Docker Compose not available${NC}"
    exit 1
fi

# Start monitoring services
echo ""
echo "Starting monitoring services..."

services_started=0
total_services=4

# Start Prometheus
if start_service "Prometheus" "prometheus"; then
    services_started=$((services_started + 1))
fi

# Start Grafana
if start_service "Grafana" "grafana"; then
    services_started=$((services_started + 1))
fi

# Start Alertmanager
if start_service "Alertmanager" "alertmanager"; then
    services_started=$((services_started + 1))
fi

# Start Node Exporter
if start_service "Node Exporter" "node-exporter"; then
    services_started=$((services_started + 1))
fi

# Summary
echo ""
echo "📊 Monitoring Startup Summary:"
echo "  Services Started: $services_started/$total_services"

if [ $services_started -eq $total_services ]; then
    echo -e "${GREEN}🎉 All monitoring services started successfully!${NC}"
    echo ""
    echo "🌐 Access URLs:"
    echo "  Prometheus: http://localhost:9090"
    echo "  Grafana: http://localhost:3001 (admin/admin)"
    echo "  Alertmanager: http://localhost:9093"
    echo "  Node Exporter: http://localhost:9100/metrics"
else
    echo -e "${YELLOW}⚠️  Some monitoring services failed to start${NC}"
    echo "Check the logs for more information:"
    echo "  docker-compose -f docker-compose.prod.yml logs [service-name]"
fi

echo ""
echo "📈 Next Steps:"
echo "  1. Open Grafana: http://localhost:3001"
echo "  2. Import dashboards from monitoring/dashboards/"
echo "  3. Configure alert notifications"
echo "  4. Set up monitoring rules"
EOF
    
    chmod +x scripts/start-monitoring.sh
    
    print_success "Monitoring startup script created"
}

# Create alert notification setup
create_alert_notifications() {
    print_status "Creating alert notification setup..."
    
    # Slack webhook configuration
    cat > monitoring/alerts/slack-webhook.json << 'EOF'
{
  "webhook_url": "https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK",
  "channel": "#alerts",
  "username": "AI Council Alerts",
  "icon_emoji": ":warning:",
  "fields": [
    {
      "title": "Alert",
      "value": "{{ .CommonLabels.alertname }}",
      "short": true
    },
    {
      "title": "Severity",
      "value": "{{ .CommonLabels.severity }}",
      "short": true
    },
    {
      "title": "Description",
      "value": "{{ .CommonAnnotations.description }}",
      "short": false
    }
  ]
}
EOF
    
    # Email notification configuration
    cat > monitoring/alerts/email-config.json << 'EOF'
{
  "smtp": {
    "host": "smtp.gmail.com",
    "port": 587,
    "username": "alerts@your-domain.com",
    "password": "your-app-password",
    "from": "AI Council Alerts <alerts@your-domain.com>",
    "to": ["admin@your-domain.com", "team@your-domain.com"]
  },
  "templates": {
    "subject": "[{{ .Status | toUpper }}] AI Council Alert: {{ .GroupLabels.alertname }}",
    "body": "Alert: {{ .GroupLabels.alertname }}\nSeverity: {{ .GroupLabels.severity }}\nDescription: {{ range .Alerts }}{{ .Annotations.description }}{{ end }}\nTime: {{ .Alerts.FiringAt.Format \"2006-01-02 15:04:05\" }}"
  }
}
EOF
    
    # PagerDuty configuration
    cat > monitoring/alerts/pagerduty-config.json << 'EOF'
{
  "service_key": "YOUR_PAGERDUTY_SERVICE_KEY",
  "severity": {
    "critical": "critical",
    "warning": "warning",
    "info": "info"
  },
  "incident": {
    "title": "AI Council Alert: {{ .GroupLabels.alertname }}",
    "description": "{{ range .Alerts }}{{ .Annotations.description }}{{ end }}",
    "details": {
      "alertname": "{{ .GroupLabels.alertname }}",
      "severity": "{{ .GroupLabels.severity }}",
      "service": "ai-council",
      "component": "{{ .GroupLabels.component }}"
    }
  }
}
EOF
    
    print_success "Alert notification setup created"
}

# Create monitoring maintenance script
create_monitoring_maintenance() {
    print_status "Creating monitoring maintenance script..."
    
    cat > scripts/maintenance-monitoring.sh << 'EOF'
#!/bin/bash

# AI Council Monitoring Maintenance Script

echo "🔧 AI Council Monitoring Maintenance"
echo "=================================="

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

# Function to clean old metrics
clean_metrics() {
    echo "Cleaning old metrics data..."
    
    # Clean old Prometheus data
    docker-compose -f docker-compose.prod.yml exec prometheus \
        promtool tsdb delete --min-time=2023-01-01T00:00:00Z \
        /prometheus/data
    
    echo -e "${GREEN}✅ Old metrics cleaned${NC}"
}

# Function to backup monitoring configuration
backup_config() {
    echo "Backing up monitoring configuration..."
    
    local backup_dir="backups/monitoring/$(date +%Y%m%d_%H%M%S)"
    mkdir -p "$backup_dir"
    
    cp -r monitoring/ "$backup_dir/"
    
    echo -e "${GREEN}✅ Configuration backed up to $backup_dir${NC}"
}

# Function to check monitoring health
check_monitoring_health() {
    echo "Checking monitoring health..."
    
    local services=("prometheus" "grafana" "alertmanager" "node-exporter")
    local healthy=0
    local total=0
    
    for service in "${services[@]}"; do
        total=$((total + 1))
        
        if docker-compose -f docker-compose.prod.yml ps "$service" | grep -q "Up"; then
            echo -e "${GREEN}✅ $service is healthy${NC}"
            healthy=$((healthy + 1))
        else
            echo -e "${RED}❌ $service is not healthy${NC}"
        fi
    done
    
    echo "Monitoring Health: $healthy/$total services healthy"
    
    if [ $healthy -eq $total ]; then
        echo -e "${GREEN}✅ All monitoring services are healthy${NC}"
        return 0
    else
        echo -e "${RED}❌ Some monitoring services are unhealthy${NC}"
        return 1
    fi
}

# Function to restart monitoring services
restart_monitoring() {
    echo "Restarting monitoring services..."
    
    docker-compose -f docker-compose.prod.yml restart prometheus grafana alertmanager node-exporter
    
    echo -e "${GREEN}✅ Monitoring services restarted${NC}"
}

# Function to update monitoring configuration
update_config() {
    echo "Updating monitoring configuration..."
    
    # Reload Prometheus configuration
    docker-compose -f docker-compose.prod.yml exec prometheus \
        curl -X POST http://localhost:9090/-/reload
    
    # Reload Alertmanager configuration
    docker-compose -f docker-compose.prod.yml exec alertmanager \
        curl -X POST http://localhost:9093/-/reload
    
    echo -e "${GREEN}✅ Configuration reloaded${NC}"
}

# Main maintenance tasks
main() {
    echo "Starting monitoring maintenance..."
    
    # Check monitoring health
    if ! check_monitoring_health; then
        echo -e "${YELLOW}⚠️  Some monitoring services are unhealthy, restarting...${NC}"
        restart_monitoring
        sleep 10
        check_monitoring_health
    fi
    
    # Clean old metrics (weekly)
    if [ $(date +%u) -eq 1 ]; then
        clean_metrics
    fi
    
    # Backup configuration (daily)
    backup_config
    
    # Update configuration
    update_config
    
    echo -e "${GREEN}🎉 Monitoring maintenance completed${NC}"
}

# Handle command line arguments
case "${1:-all}" in
    "health")
        check_monitoring_health
        ;;
    "clean")
        clean_metrics
        ;;
    "backup")
        backup_config
        ;;
    "restart")
        restart_monitoring
        ;;
    "update")
        update_config
        ;;
    "all")
        main
        ;;
    *)
        echo "Usage: $0 {health|clean|backup|restart|update|all}"
        exit 1
        ;;
esac
EOF
    
    chmod +x scripts/maintenance-monitoring.sh
    
    print_success "Monitoring maintenance script created"
}

# Generate monitoring documentation
generate_monitoring_docs() {
    print_status "Generating monitoring documentation..."
    
    cat > docs/monitoring-guide.md << 'EOF'
# 📊 AI Council Monitoring Guide

## Overview
This guide covers the comprehensive monitoring, logging, and alerting system for the AI Council platform.

## Monitoring Stack

### Components
- **Prometheus**: Metrics collection and storage
- **Grafana**: Visualization and dashboards
- **Alertmanager**: Alert management and routing
- **Node Exporter**: System metrics
- **PostgreSQL Exporter**: Database metrics
- **Redis Exporter**: Cache metrics

### Architecture
```
Application → Prometheus → Alertmanager → Notifications
                ↓
              Grafana ← Dashboards
```

## Metrics Collection

### Application Metrics
- HTTP request count and duration
- Error rates by endpoint
- Active user sessions
- Token usage and costs
- PII detection events
- Security events

### Infrastructure Metrics
- CPU and memory usage
- Disk space and I/O
- Network traffic
- Container health
- Service uptime

### Database Metrics
- Connection pool usage
- Query performance
- Transaction rates
- Lock contention
- Cache hit rates

### Cache Metrics
- Memory usage
- Key count
- Hit/miss ratios
- Connection count
- Eviction rates

## Dashboards

### Main Dashboard
- Request rate and response time
- Error rate and active users
- Database connections
- Redis memory usage

### Cost Tracking Dashboard
- Daily and monthly costs
- Token usage trends
- Cost by provider
- Cost per user

### Security Dashboard
- Failed login attempts
- PII detection events
- Security incidents
- Suspicious activity

### Infrastructure Dashboard
- CPU and memory usage
- Disk space and network
- Container health
- System performance

## Alerting

### Alert Types
- **Critical**: Service down, high error rate, security breach
- **Warning**: High response time, resource usage, cost limits
- **Info**: System updates, maintenance events

### Alert Channels
- **Slack**: Real-time notifications
- **Email**: Detailed alert reports
- **PagerDuty**: Critical incident escalation
- **Webhook**: Custom integrations

### Alert Rules
- High error rate (>5%)
- High response time (>2s)
- Service downtime (>1m)
- Resource usage (>80%)
- Cost limit warnings (>80%)

## Health Checks

### Application Health
```bash
# Basic health check
curl http://localhost:3000/health

# Comprehensive health check
./scripts/health-check.sh --verbose
```

### Service Health
```bash
# Check all services
docker-compose -f docker-compose.prod.yml ps

# Check specific service
docker-compose -f docker-compose.prod.yml ps prometheus
```

### Database Health
```bash
# PostgreSQL health
docker-compose -f docker-compose.prod.yml exec db pg_isready -U postgres

# Redis health
docker-compose -f docker-compose.prod.yml exec redis redis-cli ping
```

## Log Management

### Log Types
- **Application Logs**: Request/response data, errors
- **Access Logs**: HTTP requests, user activity
- **Error Logs**: Application errors, stack traces
- **Audit Logs**: Security events, data access
- **System Logs**: Infrastructure events

### Log Rotation
- Daily rotation for application logs
- Weekly rotation for system logs
- Compression for old logs
- Retention: 30 days (application), 7 days (system)

### Log Analysis
```bash
# View recent logs
docker-compose -f docker-compose.prod.yml logs --tail=100 app

# Follow logs in real-time
docker-compose -f docker-compose.prod.yml logs -f app

# Filter logs by level
docker-compose -f docker-compose.prod.yml logs app | grep ERROR
```

## Performance Monitoring

### Key Performance Indicators
- **Response Time**: <200ms (95th percentile)
- **Throughput**: >50 requests/second
- **Error Rate**: <5%
- **Availability**: >99.9%
- **Resource Usage**: <80%

### Performance Optimization
- Database query optimization
- Caching strategies
- Load balancing
- Resource scaling

## Troubleshooting

### Common Issues

#### High Response Time
1. Check database query performance
2. Verify cache hit rates
3. Monitor resource usage
4. Review application logs

#### High Error Rate
1. Check application logs
2. Verify service dependencies
3. Monitor resource constraints
4. Review recent deployments

#### Service Unavailable
1. Check container health
2. Verify network connectivity
3. Review system resources
4. Check configuration files

#### Alert Flooding
1. Review alert thresholds
2. Check alerting rules
3. Verify notification channels
4. Adjust alert severity

### Debug Commands
```bash
# Check service status
docker-compose -f docker-compose.prod.yml ps

# View service logs
docker-compose -f docker-compose.prod.yml logs [service]

# Check resource usage
docker stats

# Test service connectivity
curl -I http://localhost:3000/health

# Check metrics endpoint
curl http://localhost:3000/metrics
```

## Maintenance

### Daily Tasks
- Check service health
- Review alert notifications
- Monitor resource usage
- Verify backup completion

### Weekly Tasks
- Clean old metrics data
- Review performance trends
- Update dashboards
- Check alert rules

### Monthly Tasks
- Review monitoring strategy
- Update alert thresholds
- Backup configuration
- Performance optimization

## Security

### Monitoring Security
- Secure metrics endpoints
- Encrypt alert notifications
- Limit access to dashboards
- Audit monitoring access

### Data Protection
- Encrypt sensitive metrics
- Anonymize user data
- Secure log storage
- Implement access controls

## Best Practices

### Metrics Design
- Use meaningful metric names
- Include relevant labels
- Avoid high cardinality
- Document metric definitions

### Alerting Strategy
- Set meaningful thresholds
- Use escalation policies
- Include actionable information
- Test alert delivery

### Dashboard Design
- Focus on key metrics
- Use consistent layouts
- Include context information
- Optimize for performance

## Integration

### External Tools
- **PagerDuty**: Incident management
- **Slack**: Team notifications
- **Jira**: Issue tracking
- **GitHub**: Code monitoring

### API Integration
- Custom metrics endpoints
- Webhook notifications
- REST API access
- GraphQL queries

## Scaling

### Horizontal Scaling
- Multiple Prometheus instances
- Grafana clustering
- Load balancing
- Data sharding

### Vertical Scaling
- Resource allocation
- Performance tuning
- Storage optimization
- Network optimization

---

## 📊 Monitoring Summary

The AI Council platform includes comprehensive monitoring with:

- **Real-time metrics** collection and visualization
- **Intelligent alerting** with multiple notification channels
- **Comprehensive logging** with rotation and analysis
- **Health monitoring** for all system components
- **Performance tracking** with detailed dashboards
- **Security monitoring** with incident detection
- **Cost tracking** with budget alerts
- **Maintenance automation** with scheduled tasks

This monitoring stack ensures the platform remains reliable, performant, and secure in production.
EOF
    
    print_success "Monitoring documentation generated"
}

# Main execution
main() {
    create_monitoring_config
    create_alerting_rules
    create_grafana_dashboards
    create_logging_config
    create_health_checks
    create_monitoring_startup
    create_alert_notifications
    create_monitoring_maintenance
    generate_monitoring_docs
    
    print_success "Production monitoring setup completed"
    echo ""
    echo "📊 Monitoring Summary:"
    echo "  ✅ Prometheus configuration created"
    echo "  ✅ Comprehensive alerting rules configured"
    echo "  ✅ Grafana dashboards created"
    echo "  ✅ Logging configuration set up"
    echo "  ✅ Health check scripts created"
    echo "  ✅ Monitoring startup script created"
    echo "  ✅ Alert notification setup created"
    echo "  ✅ Maintenance automation created"
    echo "  ✅ Monitoring documentation generated"
    echo ""
    echo "🚀 Quick Start:"
    echo "  ./scripts/start-monitoring.sh"
    echo "  ./scripts/health-check.sh --verbose"
    echo "  ./scripts/maintenance-monitoring.sh all"
    echo ""
    echo "🌐 Access URLs:"
    echo "  Prometheus: http://localhost:9090"
    echo "  Grafana: http://localhost:3001 (admin/admin)"
    echo "  Alertmanager: http://localhost:9093"
    echo ""
    echo "📖 Monitoring Guide: docs/monitoring-guide.md"
}

# Handle command line arguments
case "${1:-all}" in
    "start")
        ./scripts/start-monitoring.sh
        ;;
    "health")
        ./scripts/health-check.sh --verbose
        ;;
    "maintenance")
        ./scripts/maintenance-monitoring.sh all
        ;;
    "docs")
        generate_monitoring_docs
        ;;
    "all")
        main
        ;;
    *)
        echo "Usage: $0 {start|health|maintenance|docs|all}"
        echo ""
        echo "Commands:"
        echo "  start       - Start monitoring services"
        echo "  health      - Run health checks"
        echo "  maintenance - Run maintenance tasks"
        echo "  docs        - Generate documentation"
        echo "  all         - Run complete setup (default)"
        exit 1
        ;;
esac
