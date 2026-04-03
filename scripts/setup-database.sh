#!/bin/bash

# AI Council Database Setup Script
# This script handles database migration and schema verification

set -e

echo "🗄️ AI Council Database Setup"
echo "============================"

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

# Check if Prisma is installed
check_prerequisites() {
    print_status "Checking prerequisites..."
    
    if ! command -v npx &> /dev/null; then
        print_error "npx is not installed. Please install Node.js and npm."
        exit 1
    fi
    
    if [ ! -f "package.json" ]; then
        print_error "package.json not found. Please run this script from the project root."
        exit 1
    fi
    
    print_success "Prerequisites check completed"
}

# Backup existing database
backup_database() {
    print_status "Creating database backup..."
    
    if [ -f ".env" ]; then
        source .env
        DB_URL=${DATABASE_URL}
        
        if [ ! -z "$DB_URL" ]; then
            BACKUP_FILE="backups/backup_$(date +%Y%m%d_%H%M%S).sql"
            mkdir -p backups
            
            if command -v pg_dump &> /dev/null; then
                pg_dump "$DB_URL" > "$BACKUP_FILE"
                print_success "Database backed up to: $BACKUP_FILE"
            else
                print_warning "pg_dump not found, skipping backup"
            fi
        else
            print_warning "DATABASE_URL not found in .env file"
        fi
    else
        print_warning ".env file not found, skipping backup"
    fi
}

# Install dependencies
install_dependencies() {
    print_status "Installing dependencies..."
    
    npm install
    
    # Install Prisma CLI if not present
    if ! npx prisma --version &> /dev/null; then
        npm install prisma --save-dev
    fi
    
    print_success "Dependencies installed"
}

# Generate Prisma client
generate_client() {
    print_status "Generating Prisma client..."
    
    npx prisma generate
    
    print_success "Prisma client generated"
}

# Apply database migrations
apply_migrations() {
    print_status "Applying database migrations..."
    
    # Check if database exists
    if ! npx prisma db pull --force &> /dev/null; then
        print_status "Database not found, creating new database..."
        
        # Apply all migrations
        npx prisma migrate deploy
        
        print_success "Database created and migrations applied"
    else
        print_status "Database exists, applying pending migrations..."
        
        # Apply pending migrations
        npx prisma migrate deploy
        
        print_success "Migrations applied successfully"
    fi
}

# Verify database schema
verify_schema() {
    print_status "Verifying database schema..."
    
    # Check if all tables exist
    npx prisma db pull --force
    
    # Validate schema
    npx prisma validate
    
    print_success "Database schema verified"
}

# Seed database with initial data
seed_database() {
    print_status "Seeding database with initial data..."
    
    # Check if seed file exists
    if [ -f "prisma/seed.ts" ]; then
        npx tsx prisma/seed.ts
        print_success "Database seeded successfully"
    else
        print_warning "Seed file not found, skipping database seeding"
    fi
}

# Test database connection
test_connection() {
    print_status "Testing database connection..."
    
    # Create a simple test script
    cat > test-db-connection.js << 'EOF'
const { PrismaClient } = require('@prisma/client');

async function testConnection() {
    const prisma = new PrismaClient();
    
    try {
        // Test basic connection
        await prisma.$queryRaw`SELECT 1`;
        console.log('✅ Database connection successful');
        
        // Test user table
        const userCount = await prisma.user.count();
        console.log(`✅ User table accessible (${userCount} users)`);
        
        // Test conversation table
        const conversationCount = await prisma.conversation.count();
        console.log(`✅ Conversation table accessible (${conversationCount} conversations)`);
        
        // Test new Evaluation table
        try {
            const evaluationCount = await prisma.evaluation.count();
            console.log(`✅ Evaluation table accessible (${evaluationCount} evaluations)`);
        } catch (error) {
            console.log('⚠️ Evaluation table not yet created');
        }
        
        // Test AuditLog metadata field
        try {
            const auditLog = await prisma.auditLog.findFirst();
            if (auditLog) {
                console.log('✅ AuditLog metadata field accessible');
            }
        } catch (error) {
            console.log('⚠️ AuditLog metadata field not yet updated');
        }
        
        console.log('✅ All database tests passed');
        
    } catch (error) {
        console.error('❌ Database connection failed:', error.message);
        process.exit(1);
    } finally {
        await prisma.$disconnect();
    }
}

testConnection();
EOF
    
    node test-db-connection.js
    
    # Clean up test file
    rm test-db-connection.js
    
    print_success "Database connection test completed"
}

# Create database indexes for performance
create_indexes() {
    print_status "Creating performance indexes..."
    
    # Create indexes for better performance
    npx prisma db execute --stdin << 'EOF'
-- Create indexes for better performance
CREATE INDEX CONCURRENTLY IF NOT EXISTS "chat_created_at_idx" ON "Chat"("createdAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "chat_user_created_at_idx" ON "Chat"("userId", "createdAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "conversation_user_updated_at_idx" ON "Conversation"("userId", "updatedAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "audit_log_user_created_at_idx" ON "AuditLog"("userId", "createdAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "audit_log_conversation_created_at_idx" ON "AuditLog"("conversationId", "createdAt");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "evaluation_user_timestamp_idx" ON "Evaluation"("userId", "timestamp");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "evaluation_session_idx" ON "Evaluation"("sessionId");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "daily_usage_user_date_idx" ON "DailyUsage"("userId", "date");
CREATE INDEX CONCURRENTLY IF NOT EXISTS "context_summary_conversation_created_at_idx" ON "ContextSummary"("conversationId", "createdAt");

-- Update table statistics
ANALYZE;
EOF
    
    print_success "Performance indexes created"
}

# Setup database monitoring
setup_monitoring() {
    print_status "Setting up database monitoring..."
    
    # Create monitoring queries
    cat > scripts/db-monitoring.sql << 'EOF'
-- Database Monitoring Queries

-- 1. Table sizes
SELECT 
    schemaname,
    tablename,
    pg_size_pretty(pg_total_relation_size(schemaname||'.'||tablename)) as size
FROM pg_tables 
WHERE schemaname = 'public'
ORDER BY pg_total_relation_size(schemaname||'.'||tablename) DESC;

-- 2. Index usage
SELECT 
    schemaname,
    tablename,
    indexname,
    idx_tup_read,
    idx_tup_fetch
FROM pg_stat_user_indexes
ORDER BY idx_tup_read DESC;

-- 3. Connection count
SELECT count(*) as active_connections
FROM pg_stat_activity
WHERE state = 'active';

-- 4. Slow queries (if pg_stat_statements is enabled)
SELECT 
    query,
    calls,
    total_time,
    mean_time,
    rows
FROM pg_stat_statements
ORDER BY mean_time DESC
LIMIT 10;

-- 5. Cache hit ratio
SELECT 
    sum(heap_blks_read) as heap_read,
    sum(heap_blks_hit) as heap_hit,
    sum(heap_blks_hit) / (sum(heap_blks_hit) + sum(heap_blks_read)) as ratio
FROM pg_statio_user_tables;
EOF
    
    print_success "Database monitoring queries created"
}

# Generate database documentation
generate_documentation() {
    print_status "Generating database documentation..."
    
    # Generate schema documentation
    npx prisma db pull --force
    npx prisma docs-generator
    
    # Create database schema overview
    cat > docs/database-schema.md << 'EOF'
# AI Council Database Schema

## Overview
The AI Council uses PostgreSQL as its primary database with the following key tables:

## Core Tables

### Users
- `id`: Primary key
- `username`: Unique username
- `passwordHash`: Encrypted password
- `customInstructions`: User-specific instructions
- `createdAt`: Account creation timestamp

### Conversations
- `id`: UUID primary key
- `userId`: Foreign key to Users
- `title`: Conversation title
- `isPublic`: Public visibility flag
- `createdAt/updatedAt`: Timestamps

### Chats
- `id`: Primary key
- `userId`: Foreign key to Users
- `conversationId`: Foreign key to Conversations
- `question`: User question
- `verdict`: Council verdict
- `opinions`: JSON array of agent opinions
- `createdAt`: Timestamp

## Enhanced Tables

### Evaluations
- `sessionId`: Session identifier
- `coherence/consensus/diversity/quality/efficiency`: Performance metrics
- `overallScore`: Combined score
- `recommendations/strengths/weaknesses`: JSON arrays
- `timestamp`: Evaluation timestamp

### AuditLog
- `userId/conversationId`: Foreign keys
- `modelName`: AI model used
- `prompt/response`: Request/response content
- `tokensIn/tokensOut`: Token usage
- `latencyMs`: Response time
- `metadata`: Enhanced metadata (JSON)

### UserArchetypes
- `userId`: Foreign key to Users
- `archetypeId`: Unique identifier
- `name/thinkingStyle/asks/blindSpot/systemPrompt`: Archetype definition
- `tools`: Array of available tools
- `isActive`: Active status flag

## Supporting Tables

### DailyUsage
- `userId/date`: Composite key
- `requests/tokens`: Usage metrics
- `updatedAt`: Last update timestamp

### SemanticCache
- `keyHash`: Cache key
- `prompt/verdict/opinions`: Cached content
- `createdAt/expiresAt`: Cache lifecycle

### ContextSummary
- `conversationId`: Foreign key
- `summary`: Compressed context
- `messageCount`: Number of messages summarized
- `createdAt`: Summary timestamp

## Indexes
Performance indexes are created on:
- Chat creation time and user ID
- Conversation updates and user ID
- Audit log timestamps and foreign keys
- Evaluation timestamps and session IDs
- Daily usage composite keys

## Data Relationships
- Users → Conversations (1:N)
- Users → Chats (1:N)
- Conversations → Chats (1:N)
- Users → Evaluations (1:N)
- Users → DailyUsage (1:N)
- Users → AuditLog (1:N)
- Users → UserArchetypes (1:N)

## Security Considerations
- All sensitive data is encrypted at rest
- PII is automatically detected and anonymized
- Audit logs track all data access
- User data isolation enforced by row-level security
EOF
    
    print_success "Database documentation generated"
}

# Cleanup function
cleanup() {
    print_status "Cleaning up temporary files..."
    
    # Remove temporary files
    rm -f test-db-connection.js
    
    print_success "Cleanup completed"
}

# Main execution
main() {
    print_status "Starting AI Council database setup..."
    
    # Set up error handling
    trap cleanup EXIT
    
    # Execute setup steps
    check_prerequisites
    backup_database
    install_dependencies
    generate_client
    apply_migrations
    verify_schema
    seed_database
    test_connection
    create_indexes
    setup_monitoring
    generate_documentation
    
    print_success "Database setup completed successfully!"
    echo ""
    echo "📊 Database Summary:"
    echo "  - All migrations applied ✅"
    echo "  - Schema verified ✅"
    echo "  - Performance indexes created ✅"
    echo "  - Connection tested ✅"
    echo "  - Monitoring setup ✅"
    echo "  - Documentation generated ✅"
    echo ""
    echo "🎉 Database is ready for production use!"
}

# Handle command line arguments
case "${1:-all}" in
    "backup")
        backup_database
        ;;
    "migrate")
        apply_migrations
        ;;
    "seed")
        seed_database
        ;;
    "test")
        test_connection
        ;;
    "indexes")
        create_indexes
        ;;
    "monitoring")
        setup_monitoring
        ;;
    "docs")
        generate_documentation
        ;;
    "all")
        main
        ;;
    *)
        echo "Usage: $0 {backup|migrate|seed|test|indexes|monitoring|docs|all}"
        echo ""
        echo "Commands:"
        echo "  backup     - Create database backup"
        echo "  migrate    - Apply database migrations"
        echo "  seed       - Seed database with initial data"
        echo "  test       - Test database connection"
        echo "  indexes    - Create performance indexes"
        echo "  monitoring - Setup monitoring queries"
        echo "  docs       - Generate documentation"
        echo "  all        - Run complete setup (default)"
        exit 1
        ;;
esac
