#!/bin/bash

# AI Council Environment Setup Script
# This script configures all environment variables and dependencies

set -e

echo "⚙️ AI Council Environment Setup"
echo "==============================="

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
    
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed"
        exit 1
    fi
    
    if ! command -v npm &> /dev/null; then
        print_error "npm is not installed"
        exit 1
    fi
    
    NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
    if [ "$NODE_VERSION" -lt "18" ]; then
        print_error "Node.js version 18+ is required (current: $(node -v))"
        exit 1
    fi
    
    print_success "Prerequisites check completed"
}

# Create .env file from template
create_env_file() {
    print_status "Creating environment configuration..."
    
    if [ ! -f ".env.example" ]; then
        print_error ".env.example file not found"
        exit 1
    fi
    
    # Backup existing .env if it exists
    if [ -f ".env" ]; then
        cp .env .env.backup.$(date +%Y%m%d_%H%M%S)
        print_warning "Existing .env backed up"
    fi
    
    # Copy template
    cp .env.example .env
    
    print_success "Environment file created from template"
}

# Generate secure secrets
generate_secrets() {
    print_status "Generating secure secrets..."
    
    # Generate JWT secret
    JWT_SECRET=$(openssl rand -base64 32)
    sed -i "s/your-jwt-secret-here/$JWT_SECRET/" .env
    
    # Generate session secret
    SESSION_SECRET=$(openssl rand -base64 32)
    sed -i "s/your-session-secret-here/$SESSION_SECRET/" .env
    
    # Generate encryption key
    ENCRYPTION_KEY=$(openssl rand -hex 32)
    sed -i "s/your-encryption-key-here/$ENCRYPTION_KEY/" .env
    
    print_success "Secure secrets generated"
}

# Configure database connection
configure_database() {
    print_status "Configuring database connection..."
    
    # Prompt for database configuration
    echo ""
    echo "🗄️ Database Configuration:"
    echo "=========================="
    
    read -p "Database host (localhost): " DB_HOST
    DB_HOST=${DB_HOST:-localhost}
    
    read -p "Database port (5432): " DB_PORT
    DB_PORT=${DB_PORT:-5432}
    
    read -p "Database name (ai_council): " DB_NAME
    DB_NAME=${DB_NAME:-ai_council}
    
    read -p "Database username: " DB_USER
    while [ -z "$DB_USER" ]; do
        echo "Database username is required"
        read -p "Database username: " DB_USER
    done
    
    read -s -p "Database password: " DB_PASSWORD
    while [ -z "$DB_PASSWORD" ]; do
        echo ""
        echo "Database password is required"
        read -s -p "Database password: " DB_PASSWORD
    done
    echo ""
    
    # Update .env file
    DB_URL="postgresql://$DB_USER:$DB_PASSWORD@$DB_HOST:$DB_PORT/$DB_NAME"
    sed -i "s|postgresql://username:password@localhost:5432/ai_council|$DB_URL|" .env
    
    print_success "Database connection configured"
}

# Configure Redis connection
configure_redis() {
    print_status "Configuring Redis connection..."
    
    echo ""
    echo "🔴 Redis Configuration:"
    echo "====================="
    
    read -p "Redis host (localhost): " REDIS_HOST
    REDIS_HOST=${REDIS_HOST:-localhost}
    
    read -p "Redis port (6379): " REDIS_PORT
    REDIS_PORT=${REDIS_PORT:-6379}
    
    read -p "Redis password (leave empty if no auth): " REDIS_PASSWORD
    
    # Update .env file
    if [ -z "$REDIS_PASSWORD" ]; then
        REDIS_URL="redis://$REDIS_HOST:$REDIS_PORT"
    else
        REDIS_URL="redis://:$REDIS_PASSWORD@$REDIS_HOST:$REDIS_PORT"
    fi
    
    sed -i "s|redis://localhost:6379|$REDIS_URL|" .env
    
    print_success "Redis connection configured"
}

# Configure AI providers
configure_ai_providers() {
    print_status "Configuring AI providers..."
    
    echo ""
    echo "🤖 AI Provider Configuration:"
    echo "============================"
    
    # OpenAI
    echo "OpenAI Configuration:"
    read -p "OpenAI API key (leave empty to skip): " OPENAI_KEY
    if [ ! -z "$OPENAI_KEY" ]; then
        sed -i "s|sk-your-openai-api-key|$OPENAI_KEY|" .env
        print_success "OpenAI configured"
    else
        print_warning "OpenAI skipped"
    fi
    
    # Anthropic
    echo ""
    echo "Anthropic Configuration:"
    read -p "Anthropic API key (leave empty to skip): " ANTHROPIC_KEY
    if [ ! -z "$ANTHROPIC_KEY" ]; then
        sed -i "s|sk-ant-your-anthropic-api-key|$ANTHROPIC_KEY|" .env
        print_success "Anthropic configured"
    else
        print_warning "Anthropic skipped"
    fi
    
    # Google
    echo ""
    echo "Google Configuration:"
    read -p "Google API key (leave empty to skip): " GOOGLE_KEY
    if [ ! -z "$GOOGLE_KEY" ]; then
        sed -i "s|your-google-api-key|$GOOGLE_KEY|" .env
        print_success "Google configured"
    else
        print_warning "Google skipped"
    fi
}

# Configure application settings
configure_application() {
    print_status "Configuring application settings..."
    
    echo ""
    echo "🚀 Application Configuration:"
    echo "============================="
    
    # Environment
    read -p "Environment (development): " NODE_ENV
    NODE_ENV=${NODE_ENV:-development}
    sed -i "s/development/$NODE_ENV/" .env
    
    # Port
    read -p "Application port (3000): " PORT
    PORT=${PORT:-3000}
    sed -i "s/3000/$PORT/" .env
    
    # Frontend URL
    read -p "Frontend URL (http://localhost:3000): " FRONTEND_URL
    FRONTEND_URL=${FRONTEND_URL:-http://localhost:3000}
    sed -i "s|http://localhost:3000|$FRONTEND_URL|" .env
    
    # Log level
    echo ""
    echo "Log Level Options:"
    echo "1. error"
    echo "2. warn"
    echo "3. info"
    echo "4. debug"
    read -p "Choose log level (3): " LOG_CHOICE
    case ${LOG_CHOICE:-3} in
        1) LOG_LEVEL="error" ;;
        2) LOG_LEVEL="warn" ;;
        3) LOG_LEVEL="info" ;;
        4) LOG_LEVEL="debug" ;;
        *) LOG_LEVEL="info" ;;
    esac
    sed -i "s/info/$LOG_LEVEL/" .env
    
    print_success "Application settings configured"
}

# Configure cost limits
configure_cost_limits() {
    print_status "Configuring cost limits..."
    
    echo ""
    echo "💰 Cost Limit Configuration:"
    echo "==========================="
    
    read -p "Default daily limit ($): " DAILY_LIMIT
    DAILY_LIMIT=${DAILY_LIMIT:-10.0}
    sed -i "s/10.0/$DAILY_LIMIT/" .env
    
    read -p "Default monthly limit ($): " MONTHLY_LIMIT
    MONTHLY_LIMIT=${MONTHLY_LIMIT:-100.0}
    sed -i "s/100.0/$MONTHLY_LIMIT/" .env
    
    read -p "Enable cost alerts (true): " COST_ALERTS
    COST_ALERTS=${COST_ALERTS:-true}
    sed -i "s/true/$COST_ALERTS/" .env
    
    print_success "Cost limits configured"
}

# Configure monitoring
configure_monitoring() {
    print_status "Configuring monitoring..."
    
    echo ""
    echo "📊 Monitoring Configuration:"
    echo "==========================="
    
    # Metrics
    read -p "Enable metrics collection (true): " METRICS_ENABLED
    METRICS_ENABLED=${METRICS_ENABLED:-true}
    sed -i "s/true/$METRICS_ENABLED/" .env
    
    # Metrics port
    read -p "Metrics port (9090): " METRICS_PORT
    METRICS_PORT=${METRICS_PORT:-9090}
    sed -i "s/9090/$METRICS_PORT/" .env
    
    # Health check
    read -p "Enable health checks (true): " HEALTH_CHECKS
    HEALTH_CHECKS=${HEALTH_CHECKS:-true}
    sed -i "s/true/$HEALTH_CHECKS/" .env
    
    print_success "Monitoring configured"
}

# Configure local AI
configure_local_ai() {
    print_status "Configuring local AI..."
    
    echo ""
    echo "🏠 Local AI Configuration:"
    echo "========================="
    
    # Ollama
    read -p "Ollama endpoint (http://localhost:11434): " OLLAMA_ENDPOINT
    OLLAMA_ENDPOINT=${OLLAMA_ENDPOINT:-http://localhost:11434}
    sed -i "s|http://localhost:11434|$OLLAMA_ENDPOINT|" .env
    
    # LM Studio
    read -p "LM Studio endpoint (http://localhost:1234): " LM_STUDIO_ENDPOINT
    LM_STUDIO_ENDPOINT=${LM_STUDIO_ENDPOINT:-http://localhost:1234}
    sed -i "s|http://localhost:1234|$LM_STUDIO_ENDPOINT|" .env
    
    # llama.cpp
    read -p "llama.cpp endpoint (http://localhost:8080): " LLAMACPP_ENDPOINT
    LLAMACPP_ENDPOINT=${LLAMACPP_ENDPOINT:-http://localhost:8080}
    sed -i "s|http://localhost:8080|$LLAMACPP_ENDPOINT|" .env
    
    print_success "Local AI configured"
}

# Configure desktop integrations
configure_desktop() {
    print_status "Configuring desktop integrations..."
    
    echo ""
    echo "🖥️ Desktop Integration Configuration:"
    echo "====================================="
    
    # Obsidian
    read -p "Obsidian endpoint (http://localhost:42424): " OBSIDIAN_ENDPOINT
    OBSIDIAN_ENDPOINT=${OBSIDIAN_ENDPOINT:-http://localhost:42424}
    sed -i "s|http://localhost:42424|$OBSIDIAN_ENDPOINT|" .env
    
    # VS Code
    read -p "VS Code endpoint (http://localhost:3000): " VSCODE_ENDPOINT
    VSCODE_ENDPOINT=${VSCODE_ENDPOINT:-http://localhost:3000}
    sed -i "s|http://localhost:3000|$VSCODE_ENDPOINT|" .env
    
    print_success "Desktop integrations configured"
}

# Validate configuration
validate_configuration() {
    print_status "Validating configuration..."
    
    # Check required fields
    local errors=0
    
    # Check database URL
    if ! grep -q "postgresql://" .env; then
        print_error "Database URL not configured"
        errors=$((errors + 1))
    fi
    
    # Check secrets
    if grep -q "your-jwt-secret-here" .env; then
        print_error "JWT secret not generated"
        errors=$((errors + 1))
    fi
    
    if grep -q "your-session-secret-here" .env; then
        print_error "Session secret not generated"
        errors=$((errors + 1))
    fi
    
    # Check at least one AI provider
    if ! grep -q "sk-" .env && ! grep -q "your-google-api-key" .env; then
        print_warning "No AI providers configured"
    fi
    
    if [ $errors -eq 0 ]; then
        print_success "Configuration validation passed"
    else
        print_error "Configuration validation failed with $errors errors"
        exit 1
    fi
}

# Test configuration
test_configuration() {
    print_status "Testing configuration..."
    
    # Create test script
    cat > test-config.js << 'EOF'
const fs = require('fs');
const path = require('path');

// Load environment variables
require('dotenv').config();

async function testConfiguration() {
    const tests = [];
    
    // Test database connection
    try {
        const { Pool } = require('pg');
        const pool = new Pool({ connectionString: process.env.DATABASE_URL });

        await pool.query('SELECT 1');
        tests.push({ name: 'Database Connection', status: 'Passed' });

        await pool.end();
    } catch (error) {
        tests.push({ name: 'Database Connection', status: 'Failed', error: error.message });
    }
    
    // Test Redis connection
    try {
        const redis = require('redis');
        const client = redis.createClient({
            url: process.env.REDIS_URL
        });
        
        await client.connect();
        await client.ping();
        tests.push({ name: 'Redis Connection', status: '✅ Passed' });
        
        await client.quit();
    } catch (error) {
        tests.push({ name: 'Redis Connection', status: '❌ Failed', error: error.message });
    }
    
    // Test environment variables
    const requiredVars = ['DATABASE_URL', 'JWT_SECRET', 'SESSION_SECRET'];
    for (const varName of requiredVars) {
        if (process.env[varName]) {
            tests.push({ name: `Environment Variable: ${varName}`, status: '✅ Passed' });
        } else {
            tests.push({ name: `Environment Variable: ${varName}`, status: '❌ Failed' });
        }
    }
    
    // Print results
    console.log('\n🧪 Configuration Test Results:');
    console.log('============================');
    
    let passed = 0;
    let failed = 0;
    
    tests.forEach(test => {
        console.log(`${test.status} ${test.name}`);
        if (test.error) {
            console.log(`   Error: ${test.error}`);
        }
        
        if (test.status.includes('✅')) {
            passed++;
        } else {
            failed++;
        }
    });
    
    console.log('\n📊 Summary:');
    console.log(`  Passed: ${passed}`);
    console.log(`  Failed: ${failed}`);
    
    if (failed === 0) {
        console.log('🎉 All tests passed!');
        process.exit(0);
    } else {
        console.log('❌ Some tests failed');
        process.exit(1);
    }
}

testConfiguration();
EOF
    
    # Run test
    node test-config.js
    
    # Clean up
    rm test-config.js
    
    print_success "Configuration test completed"
}

# Generate configuration summary
generate_summary() {
    print_status "Generating configuration summary..."
    
    cat > docs/environment-configuration.md << 'EOF'
# AI Council Environment Configuration

## Overview
This document outlines the environment configuration for the AI Council platform.

## Required Environment Variables

### Database Configuration
- `DATABASE_URL`: PostgreSQL connection string
- Format: `postgresql://username:password@host:port/database`

### Redis Configuration
- `REDIS_URL`: Redis connection string
- Format: `redis://[password@]host:port`

### Security
- `JWT_SECRET`: Secret key for JWT token signing
- `SESSION_SECRET`: Secret key for session management
- `ENCRYPTION_KEY`: Key for data encryption

### AI Providers
- `OPENAI_API_KEY`: OpenAI API key (optional)
- `ANTHROPIC_API_KEY`: Anthropic API key (optional)
- `GOOGLE_API_KEY`: Google AI API key (optional)

### Application Settings
- `NODE_ENV`: Environment (development/production)
- `PORT`: Application port (default: 3000)
- `FRONTEND_URL`: Frontend application URL
- `LOG_LEVEL`: Logging level (error/warn/info/debug)

### Cost Management
- `DEFAULT_DAILY_LIMIT`: Default daily cost limit
- `DEFAULT_MONTHLY_LIMIT`: Default monthly cost limit
- `COST_ALERTS_ENABLED`: Enable cost alerts

### Monitoring
- `METRICS_ENABLED`: Enable metrics collection
- `METRICS_PORT`: Metrics server port
- `HEALTH_CHECKS_ENABLED`: Enable health checks

### Local AI
- `OLLAMA_ENDPOINT`: Ollama API endpoint
- `LM_STUDIO_ENDPOINT`: LM Studio endpoint
- `LLAMACPP_ENDPOINT`: llama.cpp endpoint

### Desktop Integrations
- `OBSIDIAN_ENDPOINT`: Obsidian local API endpoint
- `VSCODE_ENDPOINT`: VS Code extension endpoint

## Security Considerations

### Secrets Management
- All secrets should be generated using cryptographically secure methods
- Secrets should be stored securely in production (environment variables, secret manager)
- Regular rotation of secrets is recommended

### Database Security
- Use SSL connections in production
- Implement proper user permissions
- Regular database backups

### API Keys
- Store API keys securely
- Implement rate limiting
- Monitor API key usage

## Configuration Validation

The system validates configuration on startup:
- Database connectivity
- Redis connectivity
- Required environment variables
- API key validity (where possible)

## Environment-Specific Configurations

### Development
- Debug logging enabled
- Hot reload enabled
- Local database and Redis

### Production
- Error/warn logging only
- SSL certificates required
- External database and Redis
- Monitoring and alerting enabled

## Troubleshooting

### Common Issues
1. **Database Connection**: Check DATABASE_URL format and credentials
2. **Redis Connection**: Verify Redis server is running and accessible
3. **API Keys**: Ensure keys are valid and have proper permissions
4. **Port Conflicts**: Check if ports are already in use

### Debug Mode
Set `LOG_LEVEL=debug` for detailed logging during troubleshooting.
EOF
    
    print_success "Configuration summary generated"
}

# Create environment-specific templates
create_templates() {
    print_status "Creating environment templates..."
    
    # Production template
    cat > .env.production << 'EOF'
# Production Environment Configuration
NODE_ENV=production
PORT=3000
FRONTEND_URL=https://your-domain.com

# Database
DATABASE_URL=postgresql://username:password@host:5432/ai_council_prod
REDIS_URL=redis://password@host:6379

# Security
JWT_SECRET=your-production-jwt-secret
SESSION_SECRET=your-production-session-secret
ENCRYPTION_KEY=your-production-encryption-key

# AI Providers
OPENAI_API_KEY=sk-your-production-openai-key
ANTHROPIC_API_KEY=sk-ant-your-production-anthropic-key
GOOGLE_API_KEY=your-production-google-key

# Cost Management
DEFAULT_DAILY_LIMIT=50.0
DEFAULT_MONTHLY_LIMIT=500.0
COST_ALERTS_ENABLED=true

# Monitoring
METRICS_ENABLED=true
METRICS_PORT=9090
HEALTH_CHECKS_ENABLED=true

# Logging
LOG_LEVEL=warn

# Local AI (if used)
OLLAMA_ENDPOINT=http://localhost:11434
LM_STUDIO_ENDPOINT=http://localhost:1234
LLAMACPP_ENDPOINT=http://localhost:8080

# Desktop Integrations
OBSIDIAN_ENDPOINT=http://localhost:42424
VSCODE_ENDPOINT=http://localhost:3000
EOF
    
    # Staging template
    cat > .env.staging << 'EOF'
# Staging Environment Configuration
NODE_ENV=staging
PORT=3001
FRONTEND_URL=https://staging.your-domain.com

# Database
DATABASE_URL=postgresql://username:password@host:5432/ai_council_staging
REDIS_URL=redis://host:6379

# Security
JWT_SECRET=your-staging-jwt-secret
SESSION_SECRET=your-staging-session-secret
ENCRYPTION_KEY=your-staging-encryption-key

# AI Providers
OPENAI_API_KEY=sk-your-staging-openai-key
ANTHROPIC_API_KEY=sk-ant-your-staging-anthropic-key
GOOGLE_API_KEY=your-staging-google-key

# Cost Management
DEFAULT_DAILY_LIMIT=25.0
DEFAULT_MONTHLY_LIMIT=250.0
COST_ALERTS_ENABLED=true

# Monitoring
METRICS_ENABLED=true
METRICS_PORT=9091
HEALTH_CHECKS_ENABLED=true

# Logging
LOG_LEVEL=info

# Local AI
OLLAMA_ENDPOINT=http://localhost:11434
LM_STUDIO_ENDPOINT=http://localhost:1234
LLAMACPP_ENDPOINT=http://localhost:8080

# Desktop Integrations
OBSIDIAN_ENDPOINT=http://localhost:42424
VSCODE_ENDPOINT=http://localhost:3001
EOF
    
    print_success "Environment templates created"
}

# Main execution
main() {
    print_status "Starting AI Council environment setup..."
    
    # Execute setup steps
    check_prerequisites
    create_env_file
    generate_secrets
    configure_database
    configure_redis
    configure_ai_providers
    configure_application
    configure_cost_limits
    configure_monitoring
    configure_local_ai
    configure_desktop
    validate_configuration
    test_configuration
    generate_summary
    create_templates
    
    print_success "Environment setup completed successfully!"
    echo ""
    echo "⚙️ Configuration Summary:"
    echo "  - Environment file created ✅"
    echo "  - Secure secrets generated ✅"
    echo "  - Database connection configured ✅"
    echo "  - Redis connection configured ✅"
    echo "  - AI providers configured ✅"
    echo "  - Application settings configured ✅"
    echo "  - Cost limits configured ✅"
    echo "  - Monitoring configured ✅"
    echo "  - Local AI configured ✅"
    echo "  - Desktop integrations configured ✅"
    echo "  - Configuration validated ✅"
    echo "  - Templates created ✅"
    echo ""
    echo "🎉 Environment is ready for development!"
    echo ""
    echo "📝 Next Steps:"
    echo "  1. Review .env file and make any necessary adjustments"
    echo "  2. Run 'npm install' to install dependencies"
    echo "  3. Run 'npm run dev' to start development server"
    echo "  4. Visit http://localhost:3000 to verify setup"
}

# Handle command line arguments
case "${1:-all}" in
    "database")
        configure_database
        ;;
    "providers")
        configure_ai_providers
        ;;
    "secrets")
        generate_secrets
        ;;
    "validate")
        validate_configuration
        ;;
    "test")
        test_configuration
        ;;
    "templates")
        create_templates
        ;;
    "all")
        main
        ;;
    *)
        echo "Usage: $0 {database|providers|secrets|validate|test|templates|all}"
        echo ""
        echo "Commands:"
        echo "  database   - Configure database connection"
        echo "  providers  - Configure AI providers"
        echo "  secrets    - Generate secure secrets"
        echo "  validate   - Validate configuration"
        echo "  test       - Test configuration"
        echo "  templates  - Create environment templates"
        echo "  all        - Run complete setup (default)"
        exit 1
        ;;
esac
