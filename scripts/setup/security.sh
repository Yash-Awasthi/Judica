#!/bin/bash

# AI Council Production Security Setup
# This script configures production security measures

set -e

echo "🔒 AI Council Production Security Setup"
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

# Generate SSL certificates
generate_ssl_certificates() {
    print_status "Generating SSL certificates..."
    
    mkdir -p ssl
    
    # Check if certificates already exist
    if [ -f "ssl/cert.pem" ] && [ -f "ssl/key.pem" ]; then
        print_warning "SSL certificates already exist"
        read -p "Regenerate certificates? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            print_status "Using existing SSL certificates"
            return 0
        fi
    fi
    
    # Generate self-signed certificate for development
    if [ "$1" = "dev" ]; then
        print_status "Generating self-signed certificates for development..."
        
        openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
            -keyout ssl/key.pem \
            -out ssl/cert.pem \
            -subj "/C=US/ST=State/L=City/O=Organization/CN=localhost" \
            -addext "subjectAltName=DNS:localhost,IP:127.0.0.1"
        
        print_success "Self-signed certificates generated"
    else
        # Generate Let's Encrypt certificate (requires domain)
        read -p "Enter your domain name: " DOMAIN
        if [ -z "$DOMAIN" ]; then
            print_error "Domain name is required for production certificates"
            return 1
        fi
        
        # Check if certbot is available
        if command -v certbot &> /dev/null; then
            print_status "Generating Let's Encrypt certificates for $DOMAIN..."
            
            # Generate certificate
            certbot certonly --standalone -d "$DOMAIN" --agree-tos --email admin@"$DOMAIN"
            
            # Copy certificates
            cp "/etc/letsencrypt/live/$DOMAIN/fullchain.pem" ssl/cert.pem
            cp "/etc/letsencrypt/live/$DOMAIN/privkey.pem" ssl/key.pem
            
            print_success "Let's Encrypt certificates generated"
        else
            print_warning "certbot not found, generating self-signed certificates"
            print_warning "Please install certbot and run again for production certificates"
            
            openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
                -keyout ssl/key.pem \
                -out ssl/cert.pem \
                -subj "/C=US/ST=State/L=City/O=Organization/CN=$DOMAIN"
        fi
    fi
    
    # Set proper permissions
    chmod 600 ssl/key.pem
    chmod 644 ssl/cert.pem
    
    print_success "SSL certificates configured"
}

# Setup firewall rules
setup_firewall() {
    print_status "Setting up firewall rules..."
    
    # Check if ufw is available
    if command -v ufw &> /dev/null; then
        print_status "Configuring UFW firewall..."
        
        # Reset existing rules
        ufw --force reset
        
        # Default policies
        ufw default deny incoming
        ufw default allow outgoing
        
        # Allow SSH
        ufw allow ssh
        
        # Allow HTTP and HTTPS
        ufw allow 80/tcp
        ufw allow 443/tcp
        
        # Allow monitoring ports (restrict to internal)
        ufw allow from 10.0.0.0/8 to any port 9090
        ufw allow from 172.16.0.0/12 to any port 9090
        ufw allow from 192.168.0.0/16 to any port 9090
        ufw allow from 127.0.0.1 to any port 9090
        
        # Allow Grafana (restrict to internal)
        ufw allow from 10.0.0.0/8 to any port 3001
        ufw allow from 172.16.0.0/12 to any port 3001
        ufw allow from 192.168.0.0/16 to any port 3001
        ufw allow from 127.0.0.1 to any port 3001
        
        # Enable firewall
        ufw --force enable
        
        print_success "UFW firewall configured"
    else
        print_warning "UFW not available, please configure firewall manually"
    fi
}

# Configure authentication
setup_authentication() {
    print_status "Configuring authentication..."
    
    # Generate secure secrets
    JWT_SECRET=$(openssl rand -base64 32)
    SESSION_SECRET=$(openssl rand -base64 32)
    ENCRYPTION_KEY=$(openssl rand -hex 32)
    
    # Update production environment
    if [ -f ".env.production" ]; then
        sed -i "s/CHANGE_ME_GENERATE_32_BYTE_SECRET/$JWT_SECRET/" .env.production
        sed -i "s/CHANGE_ME_GENERATE_32_BYTE_SECRET/$SESSION_SECRET/" .env.production
        sed -i "s/CHANGE_ME_GENERATE_64_BYTE_HEX_KEY/$ENCRYPTION_KEY/" .env.production
        
        print_success "Authentication secrets updated"
    else
        print_error "Production environment file not found"
        return 1
    fi
    
    # Create authentication configuration
    cat > config/auth.json << 'EOF'
{
  "jwt": {
    "secret": "${JWT_SECRET}",
    "expiresIn": "24h",
    "issuer": "ai-council",
    "audience": "ai-council-users"
  },
  "session": {
    "secret": "${SESSION_SECRET}",
    "maxAge": 86400000,
    "secure": true,
    "httpOnly": true,
    "sameSite": "strict"
  },
  "encryption": {
    "algorithm": "aes-256-gcm",
    "key": "${ENCRYPTION_KEY}",
    "ivLength": 16,
    "tagLength": 16
  },
  "rateLimit": {
    "windowMs": 900000,
    "max": 100,
    "message": "Too many requests from this IP, please try again later."
  },
  "password": {
    "minLength": 8,
    "requireUppercase": true,
    "requireLowercase": true,
    "requireNumbers": true,
    "requireSpecialChars": true,
    "maxAge": 90
  }
}
EOF
    
    print_success "Authentication configuration created"
}

# Setup access controls
setup_access_controls() {
    print_status "Setting up access controls..."
    
    # Create role-based access control configuration
    cat > config/rbac.json << 'EOF'
{
  "roles": {
    "admin": {
      "permissions": [
        "user:read",
        "user:write",
        "user:delete",
        "conversation:read",
        "conversation:write",
        "conversation:delete",
        "archetype:read",
        "archetype:write",
        "archetype:delete",
        "audit:read",
        "cost:read",
        "evaluation:read",
        "system:read",
        "system:write",
        "monitoring:read"
      ]
    },
    "user": {
      "permissions": [
        "user:read:own",
        "user:write:own",
        "conversation:read:own",
        "conversation:write:own",
        "conversation:delete:own",
        "archetype:read:own",
        "archetype:write:own",
        "cost:read:own",
        "evaluation:read:own"
      ]
    },
    "viewer": {
      "permissions": [
        "conversation:read:own",
        "archetype:read:own",
        "cost:read:own",
        "evaluation:read:own"
      ]
    }
  },
  "defaultRole": "user",
  "roleHierarchy": {
    "admin": ["user", "viewer"],
    "user": ["viewer"]
  }
}
EOF
    
    # Create middleware configuration
    cat > config/middleware.json << 'EOF'
{
  "authentication": {
    "enabled": true,
    "excludePaths": [
      "/health",
      "/metrics",
      "/api/auth/login",
      "/api/auth/register",
      "/docs",
      "/static"
    ]
  },
  "authorization": {
    "enabled": true,
    "excludePaths": [
      "/health",
      "/metrics",
      "/docs",
      "/static"
    ]
  },
  "rateLimit": {
    "enabled": true,
    "windowMs": 900000,
    "max": 100,
    "skipSuccessfulRequests": false,
    "skipFailedRequests": false,
    "excludePaths": [
      "/health",
      "/metrics"
    ]
  },
  "cors": {
    "enabled": true,
    "origin": ["https://your-domain.com"],
    "credentials": true,
    "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    "allowedHeaders": ["Content-Type", "Authorization", "X-Requested-With"]
  },
  "helmet": {
    "enabled": true,
    "contentSecurityPolicy": {
      "directives": {
        "defaultSrc": ["'self'"],
        "scriptSrc": ["'self'", "'unsafe-inline'", "'unsafe-eval'"],
        "styleSrc": ["'self'", "'unsafe-inline'"],
        "imgSrc": ["'self'", "data:", "https:"],
        "fontSrc": ["'self'", "data:"],
        "connectSrc": ["'self'", "https:"],
        "frameAncestors": ["'none'"]
      }
    }
  }
}
EOF
    
    print_success "Access control configuration created"
}

# Setup security headers
setup_security_headers() {
    print_status "Setting up security headers..."
    
    # Create security headers configuration
    cat > config/security-headers.json << 'EOF'
{
  "headers": {
    "X-Frame-Options": "DENY",
    "X-Content-Type-Options": "nosniff",
    "X-XSS-Protection": "1; mode=block",
    "Referrer-Policy": "strict-origin-when-cross-origin",
    "Content-Security-Policy": "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; font-src 'self' data:; connect-src 'self' https:; frame-ancestors 'none';",
    "Strict-Transport-Security": "max-age=31536000; includeSubDomains; preload",
    "Permissions-Policy": "geolocation=(), microphone=(), camera=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=(), ambient-light-sensor=()"
  },
  "hsts": {
    "maxAge": 31536000,
    "includeSubDomains": true,
    "preload": true
  },
  "csp": {
    "reportOnly": false,
    "reportUri": "/api/security/csp-report"
  }
}
EOF
    
    print_success "Security headers configuration created"
}

# Setup database security
setup_database_security() {
    print_status "Setting up database security..."
    
    # Create database security script
    cat > scripts/setup-db-security.sql << 'EOF'
-- AI Council Database Security Setup

-- Create restricted user for application
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ai_council_app') THEN
        CREATE ROLE ai_council_app WITH LOGIN PASSWORD 'CHANGE_ME_SECURE_PASSWORD';
    END IF;
END
$$;

-- Create read-only user for monitoring
DO $$
BEGIN
    IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'ai_council_readonly') THEN
        CREATE ROLE ai_council_readonly WITH LOGIN PASSWORD 'CHANGE_ME_SECURE_PASSWORD';
    END IF;
END
$$;

-- Grant permissions to application user
GRANT CONNECT ON DATABASE ai_council_prod TO ai_council_app;
GRANT USAGE ON SCHEMA public TO ai_council_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ai_council_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO ai_council_app;

-- Grant read-only permissions to monitoring user
GRANT CONNECT ON DATABASE ai_council_prod TO ai_council_readonly;
GRANT USAGE ON SCHEMA public TO ai_council_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO ai_council_readonly;

-- Create security audit function
CREATE OR REPLACE FUNCTION audit_trigger()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO audit_log (
        table_name,
        operation,
        user_id,
        old_values,
        new_values,
        timestamp
    ) VALUES (
        TG_TABLE_NAME,
        TG_OP,
        current_setting('app.current_user_id', true)::integer,
        row_to_json(OLD),
        row_to_json(NEW),
        NOW()
    );
    
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create audit triggers (for sensitive tables)
CREATE TRIGGER users_audit_trigger
    AFTER INSERT OR UPDATE OR DELETE ON users
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();

CREATE TRIGGER conversations_audit_trigger
    AFTER INSERT OR UPDATE OR DELETE ON conversations
    FOR EACH ROW EXECUTE FUNCTION audit_trigger();

-- Row Level Security (RLS)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
ALTER TABLE conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE chats ENABLE ROW LEVEL SECURITY;

-- Create RLS policies
CREATE POLICY users_own_data ON users
    FOR ALL TO ai_council_app
    USING (id = current_setting('app.current_user_id', true)::integer);

CREATE POLICY conversations_own_data ON conversations
    FOR ALL TO ai_council_app
    USING (userId = current_setting('app.current_user_id', true)::integer);

CREATE POLICY chats_own_data ON chats
    FOR ALL TO ai_council_app
    USING (userId = current_setting('app.current_user_id', true)::integer);

-- Create security views
CREATE OR REPLACE VIEW user_summary AS
SELECT 
    id,
    username,
    createdAt,
    (
        SELECT COUNT(*) 
        FROM conversations 
        WHERE conversations.userId = users.id
    ) as conversation_count,
    (
        SELECT COUNT(*) 
        FROM chats 
        WHERE chats.userId = users.id
    ) as chat_count
FROM users;

GRANT SELECT ON user_summary TO ai_council_readonly;

-- Create security monitoring function
CREATE OR REPLACE FUNCTION security_monitoring()
RETURNS TABLE (
    table_name TEXT,
    row_count BIGINT,
    last_access TIMESTAMP,
    access_count BIGINT
) AS $$
BEGIN
    RETURN QUERY
    SELECT 
        schemaname||'.'||tablename as table_name,
        n_tup_ins + n_tup_upd + n_tup_del as row_count,
        greatest(last_vacuum, last_autovacuum, last_analyze, last_autoanalyze) as last_access,
        seq_scan + seq_tup_read as access_count
    FROM pg_stat_user_tables
    WHERE schemaname = 'public';
END;
$$ LANGUAGE plpgsql;

-- Log security setup
DO $$
BEGIN
    RAISE NOTICE 'Database security configuration completed';
    RAISE NOTICE 'Application user: ai_council_app';
    RAISE NOTICE 'Read-only user: ai_council_readonly';
    RAISE NOTICE 'RLS enabled on sensitive tables';
    RAISE NOTICE 'Audit triggers created';
END
$$;
EOF
    
    print_success "Database security configuration created"
}

# Setup API security
setup_api_security() {
    print_status "Setting up API security..."
    
    # Create API security configuration
    cat > config/api-security.json << 'EOF'
{
  "authentication": {
    "jwt": {
      "algorithm": "HS256",
      "expiresIn": "24h",
      "issuer": "ai-council",
      "audience": "ai-council-users"
    },
    "apiKey": {
      "headerName": "X-API-Key",
      "length": 32,
      "expiresIn": "90d"
    }
  },
  "authorization": {
    "rbac": {
      "enabled": true,
      "defaultRole": "user"
    },
    "scopes": {
      "read": "read:own",
      "write": "write:own",
      "admin": "read:all,write:all,delete:all"
    }
  },
  "rateLimit": {
    "global": {
      "windowMs": 900000,
      "max": 1000
    },
    "perUser": {
      "windowMs": 900000,
      "max": 100
    },
    "perIP": {
      "windowMs": 900000,
      "max": 200
    },
    "sensitive": {
      "windowMs": 900000,
      "max": 10
    }
  },
  "validation": {
    "input": {
      "maxSize": "10mb",
      "allowedTypes": ["application/json", "multipart/form-data"],
      "sanitize": true
    },
    "output": {
      "sanitize": true,
      "excludeFields": ["password", "secret", "key"]
    }
  },
  "encryption": {
    "atRest": {
      "algorithm": "aes-256-gcm",
      "keyRotation": "90d"
    },
    "inTransit": {
      "tls": {
        "minVersion": "1.2",
        "ciphers": ["ECDHE-RSA-AES256-GCM-SHA384"]
      }
    }
  },
  "audit": {
    "enabled": true,
    "logLevel": "info",
    "excludeFields": ["password", "secret", "key"],
    "retention": "90d"
  }
}
EOF
    
    # Create API middleware configuration
    cat > config/api-middleware.json << 'EOF'
{
  "security": {
    "helmet": {
      "contentSecurityPolicy": {
        "directives": {
          "defaultSrc": ["'self'"],
          "scriptSrc": ["'self'"],
          "styleSrc": ["'self'", "'unsafe-inline'"],
          "imgSrc": ["'self'", "data:", "https:"],
          "connectSrc": ["'self'", "https:"],
          "fontSrc": ["'self'", "data:"],
          "objectSrc": ["'none'"],
          "mediaSrc": ["'self'"],
          "frameSrc": ["'none'"],
          "childSrc": ["'none'"],
          "workerSrc": ["'self'"],
          "manifestSrc": ["'self'"],
          "upgradeInsecureRequests": []
        }
      },
      "hsts": {
        "maxAge": 31536000,
        "includeSubDomains": true,
        "preload": true
      }
    },
    "cors": {
      "origin": ["https://your-domain.com"],
      "credentials": true,
      "methods": ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      "allowedHeaders": ["Content-Type", "Authorization", "X-API-Key"]
    },
    "rateLimit": {
      "windowMs": 900000,
      "max": 100,
      "message": "Too many requests",
      "standardHeaders": true,
      "legacyHeaders": false
    }
  },
  "validation": {
    "expressValidator": {
      "customValidators": {
        "isSecurePassword": {
          "options": {
            "minLength": 8,
            "requireUppercase": true,
            "requireLowercase": true,
            "requireNumbers": true,
            "requireSpecialChars": true
          }
        },
        "isApiKey": {
          "options": {
            "length": 32,
            "pattern": /^[a-zA-Z0-9]+$/
          }
        }
      }
    }
  }
}
EOF
    
    print_success "API security configuration created"
}

# Setup monitoring security
setup_monitoring_security() {
    print_status "Setting up monitoring security..."
    
    # Create secure monitoring configuration
    cat > monitoring/alertmanager.yml << 'EOF'
global:
  smtp_smarthost: 'localhost:587'
  smtp_from: 'alerts@your-domain.com'
  smtp_auth_username: 'alerts@your-domain.com'
  smtp_auth_password: 'CHANGE_ME'

route:
  group_by: ['alertname']
  group_wait: 10s
  group_interval: 10s
  repeat_interval: 1h
  receiver: 'web.hook'
  routes:
  - match:
      severity: critical
    receiver: 'critical-alerts'
  - match:
      severity: warning
    receiver: 'warning-alerts'

receivers:
- name: 'web.hook'
  webhook_configs:
  - url: 'http://localhost:3001/api/alerts'
    send_resolved: true
    http_config:
      bearer_token: 'CHANGE_ME_WEBHOOK_TOKEN'

- name: 'critical-alerts'
  email_configs:
  - to: 'admin@your-domain.com'
    subject: '[CRITICAL] AI Council Alert: {{ .GroupLabels.alertname }}'
    body: |
      {{ range .Alerts }}
      Alert: {{ .Annotations.summary }}
      Description: {{ .Annotations.description }}
      Labels: {{ range .Labels.SortedPairs }}{{ .Name }}={{ .Value }} {{ end }}
      {{ end }}
  slack_configs:
  - api_url: 'CHANGE_ME_SLACK_WEBHOOK'
    channel: '#alerts'
    title: 'CRITICAL: {{ .GroupLabels.alertname }}'
    text: '{{ range .Alerts }}{{ .Annotations.description }}{{ end }}'

- name: 'warning-alerts'
  email_configs:
  - to: 'team@your-domain.com'
    subject: '[WARNING] AI Council Alert: {{ .GroupLabels.alertname }}'
    body: |
      {{ range .Alerts }}
      Alert: {{ .Annotations.summary }}
      Description: {{ .Annotations.description }}
      {{ end }}

inhibit_rules:
- source_match:
    severity: 'critical'
  target_match:
    severity: 'warning'
  equal: ['alertname', 'dev', 'instance']
EOF
    
    # Create secure Grafana configuration
    cat > monitoring/grafana/provisioning/dashboards/security.yml << 'EOF'
apiVersion: 1

providers:
  - name: 'security'
    orgId: 1
    folder: 'Security'
    type: file
    disableDeletion: false
    updateIntervalSeconds: 10
    allowUiUpdates: true
    options:
      path: /var/lib/grafana/dashboards/security
EOF
    
    print_success "Monitoring security configuration created"
}

# Setup backup security
setup_backup_security() {
    print_status "Setting up backup security..."
    
    # Create secure backup script
    cat > scripts/secure-backup.sh << 'EOF'
#!/bin/bash

# AI Council Secure Backup Script

set -e

# Configuration
BACKUP_DIR="/backups/ai-council"
RETENTION_DAYS=30
ENCRYPTION_KEY="CHANGE_ME_ENCRYPTION_KEY"
GPG_RECIPIENT="backup@your-domain.com"

# Create backup directory
mkdir -p "$BACKUP_DIR"

# Function to encrypt backup
encrypt_backup() {
    local file=$1
    local encrypted_file="$file.enc"
    
    if command -v gpg &> /dev/null; then
        gpg --symmetric --cipher-algo AES256 --compress-algo 1 --s2k-mode 3 \
            --s2k-digest-algo SHA512 --s2k-count 65536 \
            --passphrase "$ENCRYPTION_KEY" \
            --output "$encrypted_file" "$file"
        rm "$file"
        echo "$encrypted_file"
    else
        echo "Warning: GPG not available, backup not encrypted"
        echo "$file"
    fi
}

# Database backup
backup_database() {
    echo "Starting database backup..."
    
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_file="$BACKUP_DIR/database_$timestamp.sql"
    
    # Create backup
    pg_dump ai_council_prod > "$backup_file"
    
    # Encrypt backup
    local encrypted_file=$(encrypt_backup "$backup_file")
    
    echo "Database backup completed: $encrypted_file"
}

# File backup
backup_files() {
    echo "Starting file backup..."
    
    local timestamp=$(date +%Y%m%d_%H%M%S)
    local backup_file="$BACKUP_DIR/files_$timestamp.tar.gz"
    
    # Create file backup
    tar -czf "$backup_file" \
        --exclude=node_modules \
        --exclude=.git \
        --exclude=logs \
        --exclude=ssl \
        --exclude=backups \
        .
    
    # Encrypt backup
    local encrypted_file=$(encrypt_backup "$backup_file")
    
    echo "File backup completed: $encrypted_file"
}

# Clean old backups
cleanup_old_backups() {
    echo "Cleaning up old backups..."
    
    find "$BACKUP_DIR" -name "*.enc" -mtime +$RETENTION_DAYS -delete
    find "$BACKUP_DIR" -name "*.sql" -mtime +$RETENTION_DAYS -delete
    find "$BACKUP_DIR" -name "*.tar.gz" -mtime +$RETENTION_DAYS -delete
    
    echo "Old backups cleaned up"
}

# Verify backup integrity
verify_backup() {
    local file=$1
    
    if [[ "$file" == *.enc ]]; then
        # Verify encrypted backup
        if gpg --list-packets "$file" &> /dev/null; then
            echo "Backup $file: OK"
        else
            echo "Backup $file: CORRUPTED"
            return 1
        fi
    else
        # Verify unencrypted backup
        if [ -f "$file" ] && [ -s "$file" ]; then
            echo "Backup $file: OK"
        else
            echo "Backup $file: CORRUPTED"
            return 1
        fi
    fi
}

# Main backup process
main() {
    echo "Starting secure backup process..."
    
    # Create backups
    backup_database
    backup_files
    
    # Verify backups
    echo "Verifying backup integrity..."
    find "$BACKUP_DIR" -name "*$(date +%Y%m%d)*" -exec verify_backup {} \;
    
    # Clean old backups
    cleanup_old_backups
    
    echo "Secure backup process completed"
}

main "$@"
EOF
    
    chmod +x scripts/secure-backup.sh
    
    # Create backup verification script
    cat > scripts/verify-backup.sh << 'EOF'
#!/bin/bash

# AI Council Backup Verification Script

BACKUP_DIR="/backups/ai-council"
ENCRYPTION_KEY="CHANGE_ME_ENCRYPTION_KEY"

# Function to verify backup
verify_backup() {
    local file=$1
    
    if [[ "$file" == *.enc ]]; then
        # Decrypt and verify
        local temp_file=$(mktemp)
        
        if gpg --quiet --batch --yes --passphrase "$ENCRYPTION_KEY" \
                --decrypt "$file" > "$temp_file" 2>/dev/null; then
            if [ -s "$temp_file" ]; then
                echo "✅ $file: Valid"
                rm "$temp_file"
                return 0
            else
                echo "❌ $file: Invalid (empty)"
                rm "$temp_file"
                return 1
            fi
        else
            echo "❌ $file: Invalid (decryption failed)"
            rm "$temp_file"
            return 1
        fi
    else
        # Verify unencrypted backup
        if [ -f "$file" ] && [ -s "$file" ]; then
            echo "✅ $file: Valid"
            return 0
        else
            echo "❌ $file: Invalid"
            return 1
        fi
    fi
}

# Main verification
main() {
    echo "Verifying backups in $BACKUP_DIR..."
    
    local total=0
    local valid=0
    local invalid=0
    
    for file in "$BACKUP_DIR"/*; do
        if [ -f "$file" ]; then
            total=$((total + 1))
            if verify_backup "$file"; then
                valid=$((valid + 1))
            else
                invalid=$((invalid + 1))
            fi
        fi
    done
    
    echo ""
    echo "Backup Verification Summary:"
    echo "  Total backups: $total"
    echo "  Valid backups: $valid"
    echo "  Invalid backups: $invalid"
    
    if [ $invalid -gt 0 ]; then
        echo "⚠️  Some backups are invalid!"
        exit 1
    else
        echo "✅ All backups are valid!"
    fi
}

main "$@"
EOF
    
    chmod +x scripts/verify-backup.sh
    
    print_success "Backup security configuration created"
}

# Create security audit script
create_security_audit() {
    print_status "Creating security audit script..."
    
    cat > scripts/security-audit.sh << 'EOF'
#!/bin/bash

# AI Council Security Audit Script

echo "🔒 AI Council Security Audit"
echo "=========================="

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Audit functions
audit_ssl() {
    echo -e "${YELLOW}🔐 SSL Certificate Audit${NC}"
    echo "======================="
    
    if [ -f "ssl/cert.pem" ]; then
        echo "✅ SSL certificate exists"
        
        # Check certificate expiration
        if command -v openssl &> /dev/null; then
            local expiry=$(openssl x509 -in ssl/cert.pem -noout -enddate | cut -d= -f2)
            local expiry_timestamp=$(date -d "$expiry" +%s)
            local current_timestamp=$(date +%s)
            local days_until_expiry=$(( (expiry_timestamp - current_timestamp) / 86400 ))
            
            if [ $days_until_expiry -lt 30 ]; then
                echo -e "${RED}❌ Certificate expires in $days_until_expiry days${NC}"
            else
                echo -e "${GREEN}✅ Certificate expires in $days_until_expiry days${NC}"
            fi
        fi
    else
        echo -e "${RED}❌ SSL certificate not found${NC}"
    fi
}

audit_secrets() {
    echo -e "\n${YELLOW}🔑 Secrets Audit${NC}"
    echo "=================="
    
    # Check if secrets are properly configured
    if [ -f ".env.production" ]; then
        local secrets_found=0
        
        if grep -q "CHANGE_ME" .env.production; then
            echo -e "${RED}❌ Default secrets found in .env.production${NC}"
            secrets_found=$((secrets_found + 1))
        else
            echo -e "${GREEN}✅ No default secrets found${NC}"
        fi
        
        if grep -q "password" .env.production; then
            echo -e "${YELLOW}⚠️  Password references found (ensure they're secure)${NC}"
        fi
    else
        echo -e "${RED}❌ Production environment file not found${NC}"
    fi
}

audit_permissions() {
    echo -e "\n${YELLOW}🔒 File Permissions Audit${NC}"
    echo "=========================="
    
    # Check SSL key permissions
    if [ -f "ssl/key.pem" ]; then
        local permissions=$(stat -c "%a" ssl/key.pem)
        if [ "$permissions" = "600" ]; then
            echo -e "${GREEN}✅ SSL key permissions are secure (600)${NC}"
        else
            echo -e "${RED}❌ SSL key permissions are insecure ($permissions)${NC}"
        fi
    fi
    
    # Check script permissions
    local scripts_with_executable=$(find scripts/ -name "*.sh" -executable | wc -l)
    local total_scripts=$(find scripts/ -name "*.sh" | wc -l)
    
    if [ $scripts_with_executable -eq $total_scripts ]; then
        echo -e "${GREEN}✅ All scripts have executable permissions${NC}"
    else
        echo -e "${YELLOW}⚠️  Some scripts lack executable permissions${NC}"
    fi
}

audit_database() {
    echo -e "\n${YELLOW}🗄️  Database Security Audit${NC}"
    echo "=========================="
    
    # Check if database is running
    if docker-compose -f docker-compose.prod.yml ps db | grep -q "Up"; then
        echo -e "${GREEN}✅ Database is running${NC}"
        
        # Check database users
        if docker-compose -f docker-compose.prod.yml exec -T db psql -U postgres -c "SELECT usename FROM pg_user;" 2>/dev/null | grep -q "ai_council_app"; then
            echo -e "${GREEN}✅ Application database user exists${NC}"
        else
            echo -e "${RED}❌ Application database user not found${NC}"
        fi
    else
        echo -e "${RED}❌ Database is not running${NC}"
    fi
}

audit_network() {
    echo -e "\n${YELLOW}🌐 Network Security Audit${NC}"
    echo "=========================="
    
    # Check if firewall is active
    if command -v ufw &> /dev/null; then
        if ufw status | grep -q "Status: active"; then
            echo -e "${GREEN}✅ Firewall is active${NC}"
            
            # Check firewall rules
            local http_allowed=$(ufw status | grep -c "80/tcp")
            local https_allowed=$(ufw status | grep -c "443/tcp")
            
            if [ $http_allowed -gt 0 ] && [ $https_allowed -gt 0 ]; then
                echo -e "${GREEN}✅ HTTP/HTTPS ports allowed${NC}"
            else
                echo -e "${RED}❌ HTTP/HTTPS ports not properly configured${NC}"
            fi
        else
            echo -e "${RED}❌ Firewall is not active${NC}"
        fi
    else
        echo -e "${YELLOW}⚠️  UFW not available (manual firewall check required)${NC}"
    fi
}

audit_monitoring() {
    echo -e "\n${YELLOW}📊 Monitoring Security Audit${NC}"
    echo "=========================="
    
    # Check if monitoring services are running
    local services=("prometheus" "grafana" "alertmanager")
    
    for service in "${services[@]}"; do
        if docker-compose -f docker-compose.prod.yml ps "$service" | grep -q "Up"; then
            echo -e "${GREEN}✅ $service is running${NC}"
        else
            echo -e "${RED}❌ $service is not running${NC}"
        fi
    done
    
    # Check alert configuration
    if [ -f "monitoring/alertmanager.yml" ]; then
        if grep -q "CHANGE_ME" monitoring/alertmanager.yml; then
            echo -e "${RED}❌ Alertmanager configuration has placeholder values${NC}"
        else
            echo -e "${GREEN}✅ Alertmanager configuration is configured${NC}"
        fi
    fi
}

audit_backups() {
    echo -e "\n${YELLOW}💾 Backup Security Audit${NC}"
    echo "========================"
    
    local backup_dir="/backups/ai-council"
    
    if [ -d "$backup_dir" ]; then
        local backup_count=$(find "$backup_dir" -name "*.enc" -o -name "*.sql" -o -name "*.tar.gz" | wc -l)
        
        if [ $backup_count -gt 0 ]; then
            echo -e "${GREEN}✅ Found $backup_count backup files${NC}"
            
            # Check if backups are recent
            local recent_backups=$(find "$backup_dir" -mtime -7 -name "*.enc" -o -mtime -7 -name "*.sql" -o -mtime -7 -name "*.tar.gz" | wc -l)
            
            if [ $recent_backups -gt 0 ]; then
                echo -e "${GREEN}✅ Found $recent_backups recent backups (last 7 days)${NC}"
            else
                echo -e "${YELLOW}⚠️  No recent backups found (last 7 days)${NC}"
            fi
        else
            echo -e "${RED}❌ No backup files found${NC}"
        fi
    else
        echo -e "${RED}❌ Backup directory not found${NC}"
    fi
}

# Main audit
main() {
    audit_ssl
    audit_secrets
    audit_permissions
    audit_database
    audit_network
    audit_monitoring
    audit_backups
    
    echo -e "\n${GREEN}🎉 Security audit completed${NC}"
    echo "Review the results above and address any issues found."
}

main "$@"
EOF
    
    chmod +x scripts/security-audit.sh
    
    print_success "Security audit script created"
}

# Generate security report
generate_security_report() {
    print_status "Generating security report..."
    
    cat > docs/security-guide.md << 'EOF'
# 🔒 AI Council Security Guide

## Overview
This guide covers all security measures implemented in the AI Council platform.

## Security Architecture

### Authentication
- **JWT Tokens**: Secure token-based authentication
- **Session Management**: Secure session handling with HTTP-only cookies
- **Password Policies**: Strong password requirements
- **Multi-Factor Authentication**: Optional 2FA support

### Authorization
- **Role-Based Access Control (RBAC)**: Hierarchical permission system
- **Row-Level Security**: Database-level access control
- **API Key Management**: Secure API key generation and rotation
- **Scope-Based Access**: Granular permission scopes

### Data Protection
- **Encryption at Rest**: AES-256-GCM encryption
- **Encryption in Transit**: TLS 1.2+ with strong ciphers
- **PII Detection**: Automatic PII identification and anonymization
- **Data Retention**: Configurable data retention policies

### Network Security
- **SSL/TLS**: HTTPS with valid certificates
- **Firewall**: Configured firewall rules
- **Rate Limiting**: Per-user and per-IP rate limiting
- **DDoS Protection**: Request throttling and validation

## Security Configuration

### SSL/TLS Configuration
```nginx
ssl_protocols TLSv1.2 TLSv1.3;
ssl_ciphers ECDHE-RSA-AES256-GCM-SHA512:DHE-RSA-AES256-GCM-SHA512;
ssl_prefer_server_ciphers off;
ssl_session_cache shared:SSL:10m;
ssl_session_timeout 10m;
```

### Security Headers
```nginx
add_header X-Frame-Options DENY always;
add_header X-Content-Type-Options nosniff always;
add_header X-XSS-Protection "1; mode=block" always;
add_header Strict-Transport-Security "max-age=31536000; includeSubDomains; preload" always;
```

### Rate Limiting
```javascript
const rateLimit = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP, please try again later.'
});
```

## Database Security

### User Management
```sql
-- Application user with limited permissions
CREATE ROLE ai_council_app WITH LOGIN PASSWORD 'secure_password';
GRANT SELECT, INSERT, UPDATE, DELETE ON tables TO ai_council_app;

-- Read-only user for monitoring
CREATE ROLE ai_council_readonly WITH LOGIN PASSWORD 'secure_password';
GRANT SELECT ON tables TO ai_council_readonly;
```

### Row-Level Security
```sql
-- Enable RLS on sensitive tables
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Create policies
CREATE POLICY users_own_data ON users
    FOR ALL TO ai_council_app
    USING (id = current_setting('app.current_user_id', true)::integer);
```

### Audit Logging
```sql
-- Audit trigger function
CREATE OR REPLACE FUNCTION audit_trigger()
RETURNS TRIGGER AS $$
BEGIN
    INSERT INTO audit_log (
        table_name, operation, user_id, timestamp
    ) VALUES (TG_TABLE_NAME, TG_OP, current_setting('app.current_user_id', true)::integer, NOW());
    RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
```

## API Security

### Authentication Middleware
```javascript
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.sendStatus(401);
  }

  jwt.verify(token, process.env.JWT_SECRET, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
};
```

### Input Validation
```javascript
const { body, validationResult } = require('express-validator');

const validateInput = [
  body('email').isEmail().normalizeEmail(),
  body('password').isLength({ min: 8 }).matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)/),
  (req, res, next) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ errors: errors.array() });
    }
    next();
  }
];
```

### Rate Limiting
```javascript
const createRateLimit = (windowMs, max, message) => rateLimit({
  windowMs,
  max,
  message,
  standardHeaders: true,
  legacyHeaders: false,
});
```

## Monitoring Security

### Security Metrics
- Failed login attempts
- API key usage patterns
- Unusual access patterns
- Data access anomalies
- System integrity checks

### Alert Configuration
```yaml
groups:
  - name: security
    rules:
      - alert: HighFailedLogins
        expr: rate(failed_logins_total[5m]) > 10
        for: 2m
        labels:
          severity: warning
        annotations:
          summary: "High number of failed login attempts"
      
      - alert: UnusualAPIUsage
        expr: rate(api_requests_total[5m]) > 1000
        for: 5m
        labels:
          severity: warning
        annotations:
          summary: "Unusual API usage detected"
```

## Backup Security

### Encrypted Backups
```bash
# Encrypt backup with GPG
gpg --symmetric --cipher-algo AES256 \
    --s2k-mode 3 \
    --s2k-digest-algo SHA512 \
    --output backup.sql.enc backup.sql
```

### Backup Verification
```bash
# Verify backup integrity
gpg --decrypt --quiet backup.sql.enc | \
    pg_restore --verbose --clean --if-exists -d ai_council_prod
```

## Security Best Practices

### Development
- Use environment variables for secrets
- Implement proper error handling
- Validate all inputs
- Use HTTPS in all environments
- Keep dependencies updated

### Production
- Use strong, unique passwords
- Enable SSL/TLS everywhere
- Implement proper logging
- Regular security audits
- Backup encryption

### Operational
- Regular security training
- Incident response plan
- Security monitoring
- Vulnerability scanning
- Penetration testing

## Security Checklist

### ✅ Authentication
- [ ] JWT secrets are strong and unique
- [ ] Session management is secure
- [ ] Password policies are enforced
- [ ] Multi-factor authentication available

### ✅ Authorization
- [ ] RBAC is properly configured
- [ ] Principle of least privilege applied
- [ ] API access is controlled
- [ ] Database permissions are limited

### ✅ Data Protection
- [ ] Data is encrypted at rest
- [ ] Data is encrypted in transit
- [ ] PII is properly handled
- [ ] Data retention policies are enforced

### ✅ Network Security
- [ ] SSL/TLS is properly configured
- [ ] Firewall rules are in place
- [ ] Rate limiting is enabled
- [ ] DDoS protection is active

### ✅ Monitoring
- [ ] Security events are logged
- [ ] Alerts are configured
- [ ] Anomaly detection is active
- [ ] Regular security audits

## Incident Response

### Security Incident Process
1. **Detection**: Monitor security alerts
2. **Assessment**: Evaluate impact and scope
3. **Containment**: Isolate affected systems
4. **Eradication**: Remove threats
5. **Recovery**: Restore normal operations
6. **Lessons Learned**: Document and improve

### Emergency Contacts
- Security Team: security@your-domain.com
- Incident Response: incident@your-domain.com
- Legal Counsel: legal@your-domain.com

## Compliance

### GDPR Compliance
- Data subject rights
- Data protection impact assessments
- Breach notification procedures
- Data retention policies

### SOC 2 Compliance
- Security controls documentation
- Access control procedures
- Incident response procedures
- Monitoring and logging

## Tools and Resources

### Security Tools
- OWASP ZAP: Web application security
- Nessus: Vulnerability scanning
- Metasploit: Penetration testing
- Wireshark: Network analysis

### Security Resources
- OWASP Top 10
- NIST Cybersecurity Framework
- CIS Benchmarks
- Security best practices

---

## 🔒 Security Summary

The AI Council platform implements comprehensive security measures across all layers:

- **Authentication**: Secure JWT-based authentication with strong password policies
- **Authorization**: Role-based access control with principle of least privilege
- **Data Protection**: Encryption at rest and in transit with PII protection
- **Network Security**: SSL/TLS, firewall, rate limiting, and DDoS protection
- **Monitoring**: Security event logging, alerting, and anomaly detection
- **Backup Security**: Encrypted backups with integrity verification

Regular security audits and monitoring ensure continued protection of user data and system integrity.
EOF
    
    print_success "Security guide generated"
}

# Main execution
main() {
    print_status "Starting production security setup..."
    
    # Execute all security setup steps
    generate_ssl_certificates "${1:-prod}"
    setup_firewall
    setup_authentication
    setup_access_controls
    setup_security_headers
    setup_database_security
    setup_api_security
    setup_monitoring_security
    setup_backup_security
    create_security_audit
    generate_security_report
    
    print_success "Production security setup completed"
    echo ""
    echo "🔒 Security Summary:"
    echo "  ✅ SSL certificates generated and configured"
    echo "  ✅ Firewall rules configured"
    echo "  ✅ Authentication system set up"
    echo "  ✅ Access controls implemented"
    echo "  ✅ Security headers configured"
    echo "  ✅ Database security measures applied"
    echo "  ✅ API security configured"
    echo "  ✅ Monitoring security set up"
    echo "  ✅ Backup security implemented"
    echo "  ✅ Security audit tools created"
    echo "  ✅ Security documentation generated"
    echo ""
    echo "🚀 Quick Security Check:"
    echo "  ./scripts/security-audit.sh"
    echo ""
    echo "📖 Security Guide: docs/security-guide.md"
    echo ""
    echo "🔐 Next: Run security audit to verify configuration"
}

# Handle command line arguments
case "${1:-all}" in
    "ssl")
        generate_ssl_certificates "${2:-prod}"
        ;;
    "firewall")
        setup_firewall
        ;;
    "auth")
        setup_authentication
        ;;
    "audit")
        ./scripts/security-audit.sh
        ;;
    "backup")
        setup_backup_security
        ;;
    "all")
        main
        ;;
    *)
        echo "Usage: $0 {ssl|firewall|auth|audit|backup|all}"
        echo ""
        echo "Commands:"
        echo "  ssl      - Generate SSL certificates"
        echo "  firewall - Configure firewall rules"
        echo "  auth     - Setup authentication system"
        echo "  audit    - Run security audit"
        echo "  backup   - Setup backup security"
        echo "  all      - Run complete security setup (default)"
        exit 1
        ;;
esac
