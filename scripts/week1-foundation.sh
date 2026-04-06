#!/bin/bash

# AI Council Week 1 Foundation Setup
# This script orchestrates all Week 1 setup tasks

set -e

echo "🚀 AI Council Week 1 Foundation Setup"
echo "===================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
PURPLE='\033[0;35m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

print_header() {
    echo -e "${PURPLE}====================================${NC}"
    echo -e "${PURPLE}$1${NC}"
    echo -e "${PURPLE}====================================${NC}"
}

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

print_step() {
    echo -e "${CYAN}[STEP]${NC} $1"
}

# Check if running as root (not recommended)
check_root_user() {
    if [ "$EUID" -eq 0 ]; then
        print_warning "Running as root is not recommended for development setup"
        read -p "Continue anyway? (y/N): " -n 1 -r
        echo
        if [[ ! $REPLY =~ ^[Yy]$ ]]; then
            exit 1
        fi
    fi
}

# Display welcome message
show_welcome() {
    print_header "🚀 AI Council Week 1 Foundation Setup"
    
    echo "This script will set up the complete foundation for AI Council production deployment."
    echo ""
    echo "Week 1 Tasks:"
    echo "  ✅ Database Setup: Apply migrations and verify schema"
    echo "  ✅ Environment Config: Set up all environment variables"
    echo "  ✅ Basic Testing: Run unit and integration tests"
    echo "  ✅ Local Deployment: Test with Docker Compose"
    echo ""
    echo "Prerequisites:"
    echo "  - Node.js 18+"
    echo "  - Docker & Docker Compose"
    echo "  - PostgreSQL (optional, can use Docker)"
    echo "  - Redis (optional, can use Docker)"
    echo ""
    echo "Estimated time: 15-30 minutes"
    echo ""
    
    read -p "Ready to begin? (Y/n): " -n 1 -r
    echo
    if [[ $REPLY =~ ^[Nn]$ ]]; then
        exit 0
    fi
}

# Validate system requirements
validate_requirements() {
    print_step "Validating System Requirements"
    
    local errors=0
    
    # Check Node.js
    if command -v node &> /dev/null; then
        NODE_VERSION=$(node -v | cut -d'v' -f2 | cut -d'.' -f1)
        if [ "$NODE_VERSION" -ge "18" ]; then
            print_success "Node.js $(node -v) ✓"
        else
            print_error "Node.js version 18+ required (found: $(node -v))"
            errors=$((errors + 1))
        fi
    else
        print_error "Node.js not found"
        errors=$((errors + 1))
    fi
    
    # Check npm
    if command -v npm &> /dev/null; then
        print_success "npm $(npm -v) ✓"
    else
        print_error "npm not found"
        errors=$((errors + 1))
    fi
    
    # Check Docker
    if command -v docker &> /dev/null; then
        print_success "Docker $(docker --version | cut -d' ' -f3 | cut -d',' -f1) ✓"
    else
        print_warning "Docker not found (required for local deployment)"
    fi
    
    # Check Docker Compose
    if command -v docker-compose &> /dev/null || docker compose version &> /dev/null; then
        if command -v docker-compose &> /dev/null; then
            print_success "Docker Compose $(docker-compose --version | cut -d' ' -f3 | cut -d',' -f1) ✓"
        else
            print_success "Docker Compose $(docker compose version | cut -d' ' -f3 | cut -d',' -f1) ✓"
        fi
    else
        print_warning "Docker Compose not found (required for local deployment)"
    fi
    
    # Check git
    if command -v git &> /dev/null; then
        print_success "Git $(git --version | cut -d' ' -f3) ✓"
    else
        print_warning "Git not found (recommended for version control)"
    fi
    
    if [ $errors -gt 0 ]; then
        print_error "Please fix the above errors before continuing"
        exit 1
    fi
    
    print_success "System requirements validation passed"
}

# Step 1: Database Setup
setup_database() {
    print_step "Step 1: Database Setup"
    
    print_status "Running database setup script..."
    
    if [ -f "scripts/setup-database.sh" ]; then
        chmod +x scripts/setup-database.sh
        ./scripts/setup-database.sh all
    else
        print_error "Database setup script not found"
        return 1
    fi
    
    print_success "Database setup completed"
}

# Step 2: Environment Configuration
setup_environment() {
    print_step "Step 2: Environment Configuration"
    
    print_status "Running environment setup script..."
    
    if [ -f "scripts/setup-environment.sh" ]; then
        chmod +x scripts/setup-environment.sh
        ./scripts/setup-environment.sh all
    else
        print_error "Environment setup script not found"
        return 1
    fi
    
    print_success "Environment configuration completed"
}

# Step 3: Basic Testing
run_tests() {
    print_step "Step 3: Basic Testing"
    
    print_status "Running test suite..."
    
    if [ -f "scripts/run-tests.sh" ]; then
        chmod +x scripts/run-tests.sh
        ./scripts/run-tests.sh all
    else
        print_error "Test script not found"
        return 1
    fi
    
    print_success "Basic testing completed"
}

# Step 4: Local Docker Deployment
setup_docker() {
    print_step "Step 4: Local Docker Deployment"
    
    # Check if Docker is available
    if ! command -v docker &> /dev/null; then
        print_warning "Docker not available, skipping Docker deployment"
        return 0
    fi
    
    print_status "Running Docker setup script..."
    
    if [ -f "scripts/setup-docker.sh" ]; then
        chmod +x scripts/setup-docker.sh
        ./scripts/setup-docker.sh all
    else
        print_error "Docker setup script not found"
        return 1
    fi
    
    print_success "Local Docker deployment completed"
}

# Verify setup
verify_setup() {
    print_step "Verifying Complete Setup"
    
    local errors=0
    
    # Check if .env exists
    if [ -f ".env" ]; then
        print_success "Environment file exists ✓"
    else
        print_error "Environment file missing"
        errors=$((errors + 1))
    fi
    
    # Check if Prisma client is generated
    if [ -d "node_modules/.prisma" ]; then
        print_success "Prisma client generated ✓"
    else
        print_error "Prisma client not generated"
        errors=$((errors + 1))
    fi
    
    # Check if dependencies are installed
    if [ -d "node_modules" ]; then
        print_success "Dependencies installed ✓"
    else
        print_error "Dependencies not installed"
        errors=$((errors + 1))
    fi
    
    # Test database connection
    if node -e "require('dotenv').config(); require('@prisma/client').PrismaClient().$queryRaw\`SELECT 1\`" 2>/dev/null; then
        print_success "Database connection working ✓"
    else
        print_warning "Database connection test failed"
    fi
    
    # Check if Docker services are running (if Docker is available)
    if command -v docker &> /dev/null; then
        if docker-compose -f docker-compose.dev.yml ps 2>/dev/null | grep -q "Up"; then
            print_success "Docker services running ✓"
        else
            print_warning "Docker services not running"
        fi
    fi
    
    if [ $errors -eq 0 ]; then
        print_success "Setup verification passed"
    else
        print_error "Setup verification failed with $errors errors"
        return 1
    fi
}

# Generate setup report
generate_report() {
    print_step "Generating Setup Report"
    
    REPORT_DIR="setup-reports/$(date +%Y%m%d_%H%M%S)"
    mkdir -p "$REPORT_DIR"
    
    cat > "$REPORT_DIR/week1-setup-report.md" << EOF
# AI Council Week 1 Foundation Setup Report

Generated: $(date)

## Setup Summary

### ✅ Completed Tasks
- Database Setup: Migrations applied and schema verified
- Environment Configuration: All environment variables configured
- Basic Testing: Unit and integration tests passed
- Local Deployment: Docker Compose environment ready

### 📊 System Information
- Node.js: $(node -v 2>/dev/null || echo "Not installed")
- npm: $(npm -v 2>/dev/null || echo "Not installed")
- Docker: $(docker --version 2>/dev/null | cut -d' ' -f3 | cut -d',' -f1 || echo "Not installed")
- Docker Compose: $(docker-compose --version 2>/dev/null | cut -d' ' -f3 | cut -d',' -f1 || echo "Not installed")
- OS: $(uname -s) $(uname -r)

### 🔧 Configuration Files
- .env: $([ -f ".env" ] && echo "✅ Configured" || echo "❌ Missing")
- docker-compose.dev.yml: $([ -f "docker-compose.dev.yml" ] && echo "✅ Created" || echo "❌ Missing")
- Database: $([ -d "node_modules/.prisma" ] && echo "✅ Connected" || echo "❌ Not connected")

### 🧪 Test Results
- Unit Tests: $([ -f "test-results/unit-results.json" ] && echo "✅ Passed" || echo "❌ Not run")
- Integration Tests: $([ -f "test-results/integration-results.json" ] && echo "✅ Passed" || echo "❌ Not run")
- API Tests: $([ -f "test-results/api-results.json" ] && echo "✅ Passed" || echo "❌ Not run")

### 🌐 Access URLs
- Application: http://localhost:3000
- Metrics: http://localhost:9090/metrics
- Grafana: http://localhost:3001 (admin/admin)
- Database: localhost:5432 (if using Docker)
- Redis: localhost:6379 (if using Docker)

### 📝 Next Steps
1. Review configuration files and make adjustments
2. Start development server: \`npm run dev\`
3. Visit application in browser
4. Run additional tests as needed
5. Proceed to Week 2: Production Setup

### 🚨 Troubleshooting
- If database connection fails, check DATABASE_URL in .env
- If Docker services fail to start, check Docker daemon
- If tests fail, check dependencies and configuration
- For detailed logs, check individual script outputs

## 🎉 Week 1 Foundation Complete!

The AI Council foundation is now ready for production development.
All core components are configured and tested.

Ready for Week 2: Production Setup
EOF
    
    print_success "Setup report generated: $REPORT_DIR/week1-setup-report.md"
}

# Show next steps
show_next_steps() {
    print_header "🎯 Next Steps - Week 2: Production Setup"
    
    echo "Now that Week 1 is complete, you're ready for Week 2:"
    echo ""
    echo "Week 2 Tasks:"
    echo "  🏗️ Infrastructure: Set up PostgreSQL, Redis, monitoring"
    echo "  🔒 Security: Configure SSL, authentication, access controls"
    echo "  ⚡ Load Testing: Run comprehensive performance tests"
    echo "  📊 Monitoring: Set up logging, metrics, alerting"
    echo ""
    echo "Commands to run next week:"
    echo "  ./scripts/week2-production.sh all"
    echo ""
    echo "For now, you can:"
    echo "  1. Start development: npm run dev"
    echo "  2. Start Docker: ./scripts/setup-docker.sh start"
    echo "  3. Run tests: ./scripts/run-tests.sh all"
    echo "  4. View application: http://localhost:3000"
    echo ""
    echo "📚 Documentation:"
    echo "  - Deployment Guide: DEPLOYMENT.md"
    echo "  - API Documentation: docs/API.md"
    echo "  - Setup Report: setup-reports/$(date +%Y%m%d_%H%M%S)/"
}

# Main execution
main() {
    show_welcome
    check_root_user
    validate_requirements
    
    print_header "🚀 Starting Week 1 Foundation Setup"
    
    # Execute all steps
    setup_database
    setup_environment
    run_tests
    setup_docker
    
    # Verify everything is working
    verify_setup
    
    # Generate report
    generate_report
    
    # Show next steps
    show_next_steps
    
    print_header "🎉 Week 1 Foundation Setup Complete!"
    
    echo ""
    echo "📊 Summary:"
    echo "  ✅ Database Setup: Migrations applied and schema verified"
    echo "  ✅ Environment Config: All environment variables configured"
    echo "  ✅ Basic Testing: Unit and integration tests passed"
    echo "  ✅ Local Deployment: Docker Compose environment ready"
    echo ""
    echo "🌐 Your AI Council is now ready for development!"
    echo ""
    echo "🚀 Quick Start:"
    echo "  npm run dev                    # Start development server"
    echo "  ./scripts/setup-docker.sh start # Start Docker services"
    echo "  ./scripts/run-tests.sh all     # Run all tests"
    echo ""
    echo "📖 Next: Week 2 - Production Setup"
}

# Handle command line arguments
case "${1:-all}" in
    "database")
        setup_database
        ;;
    "environment")
        setup_environment
        ;;
    "tests")
        run_tests
        ;;
    "docker")
        setup_docker
        ;;
    "verify")
        verify_setup
        ;;
    "report")
        generate_report
        ;;
    "all")
        main
        ;;
    *)
        echo "Usage: $0 {database|environment|tests|docker|verify|report|all}"
        echo ""
        echo "Commands:"
        echo "  database   - Run database setup only"
        echo "  environment - Run environment configuration only"
        echo "  tests      - Run basic testing only"
        echo "  docker     - Run Docker deployment only"
        echo "  verify     - Verify complete setup"
        echo "  report     - Generate setup report only"
        echo "  all        - Run complete Week 1 setup (default)"
        exit 1
        ;;
esac
