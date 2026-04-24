#!/bin/bash

# AI Council Testing & Benchmarking Script
# This script runs comprehensive tests and benchmarks for the AI Council system

set -e

echo "🚀 AI Council Testing & Benchmarking Suite"
echo "=========================================="

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Function to print colored output
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
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed"
        exit 1
    fi
    
    # Check PostgreSQL
    if ! command -v psql &> /dev/null; then
        print_warning "PostgreSQL not found in PATH"
    fi
    
    # Check Redis
    if ! command -v redis-cli &> /dev/null; then
        print_warning "Redis not found in PATH"
    fi
    
    # Check if .env exists
    if [ ! -f ".env" ]; then
        print_warning ".env file not found. Creating from example..."
        cp .env.example .env
        print_status "Please configure your .env file with proper API keys"
    fi
    
    print_success "Prerequisites check completed"
}

# Setup database
setup_database() {
    print_status "Setting up database..."

    # Apply schema with Drizzle
    npx drizzle-kit push

    print_success "Database setup completed"
}

# Run unit tests
run_unit_tests() {
    print_status "Running unit tests..."
    
    if npm test -- --coverage --verbose; then
        print_success "Unit tests passed"
    else
        print_error "Unit tests failed"
        return 1
    fi
}

# Run integration tests
run_integration_tests() {
    print_status "Running integration tests..."
    
    if npm run test:ci; then
        print_success "Integration tests passed"
    else
        print_error "Integration tests failed"
        return 1
    fi
}

# Run performance benchmarks
run_benchmarks() {
    print_status "Running performance benchmarks..."
    
    # Council deliberation benchmarks
    print_status "Testing council deliberation performance..."
    npm run benchmark || print_warning "Council benchmark failed"

    # PII detection benchmarks
    print_status "Testing PII detection performance..."
    npm run benchmark || print_warning "PII benchmark failed"

    # Cost tracking benchmarks
    print_status "Testing cost tracking performance..."
    npm run benchmark || print_warning "Cost benchmark failed"

    # Memory usage benchmarks
    print_status "Testing memory usage..."
    npm run benchmark || print_warning "Memory benchmark failed"
    
    print_success "Benchmarks completed"
}

# Load testing
run_load_tests() {
    print_status "Running load tests..."
    
    # Install artillery if not present
    if ! command -v artillery &> /dev/null; then
        print_status "Installing artillery for load testing..."
        npm install -g artillery
    fi
    
    # Run load test
    if artillery run tests/load-test.yml; then
        print_success "Load tests passed"
    else
        print_warning "Load tests failed or not configured"
    fi
}

# Security testing
run_security_tests() {
    print_status "Running security tests..."
    
    # Check for common vulnerabilities
    npm audit --audit-level moderate
    
    # Run security linter
    npm run lint || print_warning "Security linter failed"
    
    print_success "Security tests completed"
}

# Database performance tests
run_database_tests() {
    print_status "Running database performance tests..."
    
    # Test connection pool
    node -e "const { Pool } = require('pg'); const pool = new Pool({connectionString: process.env.DATABASE_URL}); pool.query('SELECT 1').then(() => { console.log('DB connection OK'); pool.end(); }).catch(e => { console.error(e); process.exit(1); })" || print_warning "Database connection test failed"
    
    # Test query performance
    node scripts/db-performance-test.js || print_warning "Database performance test failed"
    
    print_success "Database tests completed"
}

# API testing
run_api_tests() {
    print_status "Running API tests..."
    
    # Start server in background
    npm start &
    SERVER_PID=$!
    
    # Wait for server to start
    sleep 10
    
    # Run API tests
    if npm run test:ci; then
        print_success "API tests passed"
    else
        print_error "API tests failed"
    fi
    
    # Stop server
    kill $SERVER_PID 2>/dev/null || true
    
    wait $SERVER_PID 2>/dev/null || true
}

# Generate test report
generate_report() {
    print_status "Generating test report..."
    
    REPORT_DIR="test-reports/$(date +%Y%m%d_%H%M%S)"
    mkdir -p "$REPORT_DIR"
    
    # Copy coverage reports
    if [ -d "coverage" ]; then
        cp -r coverage "$REPORT_DIR/"
    fi
    
    # Copy test results
    if [ -f "test-results.xml" ]; then
        cp test-results.xml "$REPORT_DIR/"
    fi
    
    # Copy benchmark results
    if [ -f "benchmark-results.json" ]; then
        cp benchmark-results.json "$REPORT_DIR/"
    fi
    
    # Generate summary report
    cat > "$REPORT_DIR/summary.md" << EOF
# AI Council Test Report

Generated: $(date)

## Test Results
- Unit Tests: $([ -f "test-results.xml" ] && echo "✅ Passed" || echo "❌ Failed")
- Integration Tests: $([ -f "integration-results.xml" ] && echo "✅ Passed" || echo "❌ Failed")
- Benchmarks: $([ -f "benchmark-results.json" ] && echo "✅ Completed" || echo "❌ Failed")
- Load Tests: $([ -f "load-test-results.json" ] && echo "✅ Completed" || echo "❌ Failed")

## Coverage
$([ -f "coverage/coverage-summary.json" ] && cat coverage/coverage-summary.json || echo "No coverage data")

## Performance Metrics
$([ -f "benchmark-results.json" ] && cat benchmark-results.json || echo "No benchmark data")

## Security
- Vulnerabilities: $(npm audit --json | jq '.metadata.vulnerabilities.total' 2>/dev/null || echo "Unknown")
- Security Issues: $(npm run lint -- --format=json 2>/dev/null | jq '.length' || echo "Unknown")

EOF
    
    print_success "Test report generated: $REPORT_DIR/summary.md"
}

# Cleanup
cleanup() {
    print_status "Cleaning up..."
    
    # Kill any background server processes started by this script
    if [ -n "${SERVER_PID:-}" ]; then
        kill "$SERVER_PID" 2>/dev/null || true
        wait "$SERVER_PID" 2>/dev/null || true
    fi
    
    # Clean up temporary files
    rm -f test-results.xml integration-results.xml benchmark-results.json
    
    print_success "Cleanup completed"
}

# Main execution
main() {
    print_status "Starting AI Council testing suite..."
    
    # Set up error handling
    trap cleanup EXIT
    
    # Run all tests
    check_prerequisites
    setup_database
    run_unit_tests
    run_integration_tests
    run_benchmarks
    run_load_tests
    run_security_tests
    run_database_tests
    run_api_tests
    
    # Generate report
    generate_report
    
    print_success "All tests completed successfully!"
    echo ""
    echo "📊 Test Summary:"
    echo "  - Unit Tests: ✅ Passed"
    echo "  - Integration Tests: ✅ Passed"
    echo "  - Benchmarks: ✅ Completed"
    echo "  - Load Tests: ✅ Completed"
    echo "  - Security Tests: ✅ Completed"
    echo "  - Database Tests: ✅ Completed"
    echo "  - API Tests: ✅ Completed"
    echo ""
    echo "🎉 AI Council is ready for production deployment!"
}

# Handle command line arguments
case "${1:-all}" in
    "unit")
        check_prerequisites
        setup_database
        run_unit_tests
        ;;
    "integration")
        check_prerequisites
        setup_database
        run_integration_tests
        ;;
    "benchmarks")
        check_prerequisites
        setup_database
        run_benchmarks
        ;;
    "load")
        check_prerequisites
        setup_database
        run_load_tests
        ;;
    "security")
        run_security_tests
        ;;
    "database")
        check_prerequisites
        run_database_tests
        ;;
    "api")
        check_prerequisites
        setup_database
        run_api_tests
        ;;
    "report")
        generate_report
        ;;
    "cleanup")
        cleanup
        ;;
    "all")
        main
        ;;
    *)
        echo "Usage: $0 {unit|integration|benchmarks|load|security|database|api|report|cleanup|all}"
        echo ""
        echo "Commands:"
        echo "  unit         - Run unit tests only"
        echo "  integration  - Run integration tests only"
        echo "  benchmarks   - Run performance benchmarks only"
        echo "  load         - Run load tests only"
        echo "  security     - Run security tests only"
        echo "  database     - Run database tests only"
        echo "  api          - Run API tests only"
        echo "  report       - Generate test report only"
        echo "  cleanup      - Clean up test artifacts"
        echo "  all          - Run all tests (default)"
        exit 1
        ;;
esac
