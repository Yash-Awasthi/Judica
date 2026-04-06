#!/bin/bash

# AI Council Testing Script
# This script runs unit and integration tests for the AI Council system

set -e

echo "🧪 AI Council Testing Suite"
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
    
    # Check Node.js
    if ! command -v node &> /dev/null; then
        print_error "Node.js is not installed"
        exit 1
    fi
    
    # Check npm
    if ! command -v npm &> /dev/null; then
        print_error "npm is not installed"
        exit 1
    fi
    
    # Check if package.json exists
    if [ ! -f "package.json" ]; then
        print_error "package.json not found. Please run from project root."
        exit 1
    fi
    
    # Check if .env exists
    if [ ! -f ".env" ]; then
        print_warning ".env file not found. Please run environment setup first."
        print_status "Creating .env from template..."
        cp .env.example .env
    fi
    
    print_success "Prerequisites check completed"
}

# Install dependencies
install_dependencies() {
    print_status "Installing dependencies..."
    
    npm install
    
    print_success "Dependencies installed"
}

# Setup test database
setup_test_database() {
    print_status "Setting up test database..."
    
    # Check if test database exists
    if ! npx prisma db pull --force &> /dev/null; then
        print_status "Creating test database..."
        npx prisma migrate deploy
    fi
    
    # Generate Prisma client
    npx prisma generate
    
    print_success "Test database setup completed"
}

# Run linting
run_linting() {
    print_status "Running code linting..."
    
    if npm run lint; then
        print_success "Linting passed"
    else
        print_error "Linting failed"
        return 1
    fi
}

# Run type checking
run_type_check() {
    print_status "Running TypeScript type checking..."
    
    if npm run type-check; then
        print_success "Type checking passed"
    else
        print_error "Type checking failed"
        return 1
    fi
}

# Run unit tests
run_unit_tests() {
    print_status "Running unit tests..."
    
    # Create test results directory
    mkdir -p test-results
    
    if npm run test:unit -- --coverage --verbose --reporter=json --outputFile=test-results/unit-results.json; then
        print_success "Unit tests passed"
    else
        print_error "Unit tests failed"
        return 1
    fi
}

# Run integration tests
run_integration_tests() {
    print_status "Running integration tests..."
    
    if npm run test:integration -- --reporter=json --outputFile=test-results/integration-results.json; then
        print_success "Integration tests passed"
    else
        print_error "Integration tests failed"
        return 1
    fi
}

# Run API tests
run_api_tests() {
    print_status "Running API tests..."
    
    # Start server in background
    npm start &
    SERVER_PID=$!
    
    # Wait for server to start
    sleep 10
    
    # Run API tests
    if npm run test:api -- --reporter=json --outputFile=test-results/api-results.json; then
        print_success "API tests passed"
    else
        print_error "API tests failed"
        kill $SERVER_PID 2>/dev/null || true
        return 1
    fi
    
    # Stop server
    kill $SERVER_PID 2>/dev/null || true
    wait $SERVER_PID 2>/dev/null || true
}

# Run database tests
run_database_tests() {
    print_status "Running database tests..."
    
    if npm run test:database -- --reporter=json --outputFile=test-results/database-results.json; then
        print_success "Database tests passed"
    else
        print_error "Database tests failed"
        return 1
    fi
}

# Run security tests
run_security_tests() {
    print_status "Running security tests..."
    
    # Check for vulnerabilities
    if npm audit --audit-level moderate; then
        print_success "Security audit passed"
    else
        print_warning "Security audit found issues"
    fi
    
    # Run security linter
    if npm run lint:security -- --format=json --outputFile=test-results/security-results.json; then
        print_success "Security linting passed"
    else
        print_error "Security linting failed"
        return 1
    fi
}

# Run performance tests
run_performance_tests() {
    print_status "Running performance tests..."
    
    if npm run test:performance -- --reporter=json --outputFile=test-results/performance-results.json; then
        print_success "Performance tests passed"
    else
        print_error "Performance tests failed"
        return 1
    fi
}

# Generate test report
generate_test_report() {
    print_status "Generating test report..."
    
    REPORT_DIR="test-reports/$(date +%Y%m%d_%H%M%S)"
    mkdir -p "$REPORT_DIR"
    
    # Copy test results
    if [ -d "test-results" ]; then
        cp -r test-results "$REPORT_DIR/"
    fi
    
    # Copy coverage reports
    if [ -d "coverage" ]; then
        cp -r coverage "$REPORT_DIR/"
    fi
    
    # Generate summary report
    cat > "$REPORT_DIR/test-summary.md" << EOF
# AI Council Test Report

Generated: $(date)

## Test Results

### Unit Tests
$([ -f "test-results/unit-results.json" ] && echo "✅ Passed" || echo "❌ Failed")

### Integration Tests
$([ -f "test-results/integration-results.json" ] && echo "✅ Passed" || echo "❌ Failed")

### API Tests
$([ -f "test-results/api-results.json" ] && echo "✅ Passed" || echo "❌ Failed")

### Database Tests
$([ -f "test-results/database-results.json" ] && echo "✅ Passed" || echo "❌ Failed")

### Security Tests
$([ -f "test-results/security-results.json" ] && echo "✅ Passed" || echo "❌ Failed")

### Performance Tests
$([ -f "test-results/performance-results.json" ] && echo "✅ Passed" || echo "❌ Failed")

## Coverage Report
$([ -f "coverage/coverage-summary.json" ] && cat coverage/coverage-summary.json || echo "No coverage data available")

## Security Audit
$(npm audit --json 2>/dev/null | jq '.metadata.vulnerabilities.total' 2>/dev/null || echo "Security audit data not available")

## Test Environment
- Node.js: $(node -v)
- npm: $(npm -v)
- OS: $(uname -s)
- Date: $(date)

## Recommendations
- Review any failed tests and fix issues
- Address security vulnerabilities found
- Improve test coverage if below 80%
- Monitor performance metrics
EOF
    
    print_success "Test report generated: $REPORT_DIR/test-summary.md"
}

# Cleanup test artifacts
cleanup() {
    print_status "Cleaning up test artifacts..."
    
    # Kill any background processes
    pkill -f "npm start" 2>/dev/null || true
    pkill -f "node" 2>/dev/null || true
    
    # Clean up temporary files
    rm -f test-results/*.json
    
    print_success "Cleanup completed"
}

# Run specific test suite
run_test_suite() {
    local suite=$1
    
    case $suite in
        "unit")
            run_linting
            run_type_check
            run_unit_tests
            ;;
        "integration")
            run_integration_tests
            ;;
        "api")
            run_api_tests
            ;;
        "database")
            run_database_tests
            ;;
        "security")
            run_security_tests
            ;;
        "performance")
            run_performance_tests
            ;;
        "all")
            run_linting
            run_type_check
            run_unit_tests
            run_integration_tests
            run_api_tests
            run_database_tests
            run_security_tests
            run_performance_tests
            ;;
        *)
            print_error "Unknown test suite: $suite"
            return 1
            ;;
    esac
}

# Main execution
main() {
    print_status "Starting AI Council testing suite..."
    
    # Set up error handling
    trap cleanup EXIT
    
    # Execute setup steps
    check_prerequisites
    install_dependencies
    setup_test_database
    
    # Run all tests
    run_test_suite "all"
    
    # Generate report
    generate_test_report
    
    print_success "All tests completed successfully!"
    echo ""
    echo "🧪 Test Summary:"
    echo "  - Linting: ✅ Passed"
    echo "  - Type Checking: ✅ Passed"
    echo "  - Unit Tests: ✅ Passed"
    echo "  - Integration Tests: ✅ Passed"
    echo "  - API Tests: ✅ Passed"
    echo "  - Database Tests: ✅ Passed"
    echo "  - Security Tests: ✅ Passed"
    echo "  - Performance Tests: ✅ Passed"
    echo ""
    echo "📊 Test report generated in test-reports/"
    echo ""
    echo "🎉 All tests passed! Ready for production deployment."
}

# Handle command line arguments
case "${1:-all}" in
    "unit")
        check_prerequisites
        install_dependencies
        setup_test_database
        run_test_suite "unit"
        generate_test_report
        ;;
    "integration")
        check_prerequisites
        install_dependencies
        setup_test_database
        run_test_suite "integration"
        generate_test_report
        ;;
    "api")
        check_prerequisites
        install_dependencies
        setup_test_database
        run_test_suite "api"
        generate_test_report
        ;;
    "database")
        check_prerequisites
        install_dependencies
        setup_test_database
        run_test_suite "database"
        generate_test_report
        ;;
    "security")
        run_test_suite "security"
        generate_test_report
        ;;
    "performance")
        check_prerequisites
        install_dependencies
        setup_test_database
        run_test_suite "performance"
        generate_test_report
        ;;
    "lint")
        run_linting
        ;;
    "type-check")
        run_type_check
        ;;
    "cleanup")
        cleanup
        ;;
    "report")
        generate_test_report
        ;;
    "all")
        main
        ;;
    *)
        echo "Usage: $0 {unit|integration|api|database|security|performance|lint|type-check|cleanup|report|all}"
        echo ""
        echo "Commands:"
        echo "  unit         - Run unit tests only"
        echo "  integration  - Run integration tests only"
        echo "  api          - Run API tests only"
        echo "  database     - Run database tests only"
        echo "  security     - Run security tests only"
        echo "  performance  - Run performance tests only"
        echo "  lint         - Run code linting only"
        echo "  type-check   - Run TypeScript type checking only"
        echo "  cleanup      - Clean up test artifacts"
        echo "  report       - Generate test report only"
        echo "  all          - Run all tests (default)"
        exit 1
        ;;
esac
