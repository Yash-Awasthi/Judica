# 📚 AI Council API Documentation

## Overview

The AI Council provides a comprehensive RESTful API for managing AI deliberations, user authentication, cost tracking, and system administration.

## Base URL

```
Production: https://api.ai-council.com
Development: http://localhost:3000
```

## Authentication

All API endpoints (except authentication endpoints) require a valid JWT token.

### Header
```
Authorization: Bearer <jwt_token>
```

### Getting a Token
```bash
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "user@example.com", "password": "password"}'
```

## 🤖 Core Deliberation API

### Ask Council (Synchronous)

```http
POST /api/ask
```

Request body:
```json
{
  "question": "What are the implications of AI in healthcare?",
  "summon": "research",
  "customArchetypes": [],
  "tools": ["web_search"],
  "sessionId": "optional-session-id"
}
```

Response:
```json
{
  "id": "chat-id",
  "question": "What are the implications of AI in healthcare?",
  "verdict": "Based on the council's deliberation...",
  "opinions": [
    {
      "name": "Architect",
      "answer": "From a systems design perspective...",
      "reasoning": "The architectural implications include...",
      "key_points": ["Scalability", "Integration", "Security"],
      "confidence": 0.85
    }
  ],
  "sessionId": "session-123",
  "metrics": {
    "totalTokens": 2450,
    "duration": 12500,
    "consensus": 0.78
  }
}
```

### Ask Council (Streaming)

```http
POST /api/ask/stream
```

Same request body as `/api/ask`, but responses are streamed as Server-Sent Events.

Event types:
- `status`: Deliberation status updates
- `agent`: Individual agent responses
- `verdict`: Final council verdict
- `metrics`: Performance metrics
- `error`: Error messages

Example response:
```
event: status
data: {"type": "round_start", "round": 1, "agents": 3}

event: agent
data: {"name": "Architect", "status": "thinking"}

event: agent
data: {"name": "Architect", "response": {...}}

event: verdict
data: {"verdict": "Final council decision...", "confidence": 0.82}
```

## 🔧 Router API

### Auto-Route Query

```http
POST /api/council/auto-route
```

Request body:
```json
{
  "question": "How should I structure my startup?",
  "context": "Technology startup, early stage, seeking funding"
}
```

Response:
```json
{
  "summon": "business",
  "reasoning": "The query requires business expertise...",
  "confidence": 0.91,
  "alternative": "technical",
  "recommendedAgents": ["Architect", "Empiricist", "Contrarian"]
}
```

## 📊 Cost Tracking API

### Get Cost Breakdown

```http
GET /api/costs/breakdown?days=30
```

Response:
```json
{
  "breakdown": {
    "totalCost": 12.45,
    "totalTokens": 125000,
    "byProvider": {
      "openai": {"cost": 8.20, "tokens": 85000, "requests": 45},
      "anthropic": {"cost": 4.25, "tokens": 40000, "requests": 20}
    },
    "byModel": {
      "gpt-4": {"cost": 6.50, "tokens": 65000, "requests": 25},
      "claude-3-opus": {"cost": 5.95, "tokens": 60000, "requests": 40}
    },
    "byTimeframe": {
      "2024-01-01": {"cost": 2.10, "tokens": 21000, "requests": 8}
    }
  },
  "period": "30 days",
  "currency": "USD"
}
```

### Check Cost Limits

```http
GET /api/costs/limits?dailyLimit=10&monthlyLimit=100
```

Response:
```json
{
  "withinLimits": true,
  "dailyUsage": 7.25,
  "monthlyUsage": 45.50,
  "warnings": [
    "Approaching monthly cost limit: $45.50 / $100.00"
  ]
}
```

### Get Cost Efficiency

```http
GET /api/costs/efficiency?days=30
```

Response:
```json
{
  "avgCostPerRequest": 0.245,
  "avgTokensPerRequest": 1250,
  "costEfficiencyScore": 78.5,
  "recommendations": [
    "Consider using more cost-effective models for simple queries",
    "Optimize prompts to reduce token usage"
  ]
}
```

## 📈 Evaluation API

### Evaluate Council Session

```http
POST /api/evaluation/session
```

Request body:
```json
{
  "sessionId": "session-123",
  "conversationId": "conv-456",
  "agentOutputs": [
    {
      "name": "Architect",
      "answer": "Response text...",
      "reasoning": "Reasoning...",
      "key_points": ["Point 1", "Point 2"],
      "confidence": 0.85
    }
  ],
  "totalTokens": 2500,
  "duration": 15000,
  "userFeedback": 4
}
```

Response:
```json
{
  "success": true,
  "evaluation": {
    "sessionId": "session-123",
    "criteria": {
      "coherence": 0.82,
      "consensus": 0.78,
      "diversity": 0.75,
      "quality": 0.85,
      "efficiency": 0.80
    },
    "overallScore": 79.6,
    "recommendations": [
      "Improve prompt clarity to increase response coherence"
    ],
    "strengths": ["High response coherence", "Strong consensus building"],
    "weaknesses": ["Limited perspective diversity"],
    "timestamp": "2024-01-15T10:30:00Z"
  }
}
```

### Get Evaluation Metrics

```http
GET /api/evaluation/metrics?days=30
```

Response:
```json
{
  "metrics": {
    "averageConsensus": 0.76,
    "averageDiversity": 0.72,
    "averageQuality": 0.81,
    "averageEfficiency": 0.78,
    "totalEvaluations": 45,
    "improvementTrend": 0.05,
    "userSatisfaction": 4.2
  },
  "period": "30 days"
}
```

## 🔍 Search API

### Enhanced Search

```http
GET /api/history/search?q=healthcare&scope=all&sortBy=relevance&page=1&limit=20
```

Query parameters:
- `q`: Search query (required)
- `scope`: `all|questions|verdicts|opinions`
- `sortBy`: `relevance|date`
- `page`: Page number (default: 1)
- `limit`: Results per page (default: 20)
- `filters`: JSON string with date ranges and other filters

Response:
```json
{
  "data": [
    {
      "id": "chat-123",
      "question": "What are the healthcare implications of AI?",
      "verdict": "Based on analysis...",
      "conversationId": "conv-456",
      "conversationTitle": "Healthcare AI Discussion",
      "createdAt": "2024-01-15T10:30:00Z",
      "relevanceScore": 0.95,
      "highlights": {
        "question": "What are the <mark>healthcare</mark> implications of AI?",
        "verdict": "The <mark>healthcare</mark> sector faces...",
        "hasOpinionMatch": true
      }
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 156,
    "totalPages": 8
  },
  "searchMeta": {
    "query": "healthcare",
    "scope": "all",
    "totalResults": 156,
    "avgRelevance": 0.78
  }
}
```

## 🏗️ Archetypes API

### Get User Archetypes

```http
GET /api/archetypes
```

Response:
```json
{
  "archetypes": {
    "custom_architect": {
      "name": "Custom Architect",
      "thinkingStyle": "Systems-focused design thinking...",
      "asks": "How can we structure this...",
      "blindSpot": "May overlook human factors...",
      "systemPrompt": "You are an architect...",
      "tools": ["web_search"],
      "icon": "architecture",
      "colorBg": "#3B82F6",
      "isActive": true
    }
  },
  "usage": {
    "custom_architect": {"uses": 15, "lastUsed": "2024-01-15T10:30:00Z"}
  },
  "isCustom": true
}
```

### Create/Update Archetype

```http
POST /api/archetypes
```

Request body:
```json
{
  "archetypeId": "custom_expert",
  "name": "Custom Expert",
  "thinkingStyle": "Analytical and evidence-based...",
  "asks": "What evidence supports...",
  "blindSpot": "May miss innovative solutions...",
  "systemPrompt": "You are an expert...",
  "tools": ["web_search", "code_execution"],
  "icon": "psychology",
  "colorBg": "#10B981"
}
```

### Clone Default Archetype

```http
POST /api/archetypes/architect/clone
```

Request body (optional customizations):
```json
{
  "name": "My Architect",
  "thinkingStyle": "Modified thinking style..."
}
```

### Export/Import Archetypes

```http
GET /api/archetypes/export
```

Response: JSON file with all user archetypes

```http
POST /api/archetypes/import
```

Request body:
```json
{
  "jsonData": {...} // Exported archetype data
}
```

## 🔐 Authentication API

### Register User

```http
POST /api/auth/register
```

Request body:
```json
{
  "username": "user@example.com",
  "password": "securepassword123",
  "customInstructions": "I prefer concise responses"
}
```

### Login User

```http
POST /api/auth/login
```

Request body:
```json
{
  "username": "user@example.com",
  "password": "securepassword123"
}
```

Response:
```json
{
  "token": "jwt-token-here",
  "user": {
    "id": 123,
    "username": "user@example.com",
    "customInstructions": "I prefer concise responses",
    "createdAt": "2024-01-15T10:30:00Z"
  }
}
```

### Refresh Token

```http
POST /api/auth/refresh
```

Request body:
```json
{
  "token": "jwt-token-here"
}
```

### Logout

```http
POST /api/auth/logout
```

## 📝 History API

### Get Conversations

```http
GET /api/history?page=1&limit=20
```

Response:
```json
{
  "data": [
    {
      "id": "conv-456",
      "title": "Healthcare AI Discussion",
      "createdAt": "2024-01-15T10:30:00Z",
      "updatedAt": "2024-01-15T10:45:00Z",
      "_count": {"chats": 5}
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 20,
    "total": 25,
    "totalPages": 2
  }
}
```

### Get Conversation Details

```http
GET /api/history/conv-456?page=1&limit=50
```

Response:
```json
{
  "id": "conv-456",
  "title": "Healthcare AI Discussion",
  "createdAt": "2024-01-15T10:30:00Z",
  "updatedAt": "2024-01-15T10:45:00Z",
  "chats": [
    {
      "id": "chat-123",
      "question": "What are the healthcare implications of AI?",
      "verdict": "Based on analysis...",
      "opinions": [...],
      "createdAt": "2024-01-15T10:30:00Z"
    }
  ],
  "pagination": {
    "page": 1,
    "limit": 50,
    "total": 5,
    "totalPages": 1
  }
}
```

### Fork Conversation

```http
POST /api/history/conv-456/fork
```

Request body:
```json
{
  "toChatId": "chat-123"
}
```

Response:
```json
{
  "success": true,
  "forkId": "conv-789",
  "count": 3
}
```

## 🚨 Real-Time API (WebSocket)

### Connect to Real-Time Updates

```javascript
const socket = io('http://localhost:3000');

// Authenticate
socket.emit('authenticate', {
  userId: 123,
  token: 'jwt-token-here'
});

// Listen for cost updates
socket.on('cost-update', (data) => {
  console.log('Cost update:', data);
});

// Listen for cost alerts
socket.on('cost-alert', (data) => {
  console.log('Cost alert:', data.alerts);
});

// Request current cost data
socket.emit('request-cost-data', 123);

// Set cost limits
socket.emit('set-limits', {
  userId: 123,
  dailyLimit: 10,
  monthlyLimit: 100
});
```

## 🔧 Admin API

### Get Organization Cost Summary

```http
GET /api/costs/organization?days=30
```

Response:
```json
{
  "summary": {
    "totalCost": 1250.50,
    "totalTokens": 12500000,
    "totalRequests": 5000,
    "userBreakdown": [
      {"userId": 123, "cost": 125.50, "tokens": 1250000, "requests": 500}
    ],
    "dailyTrend": [
      {"date": "2024-01-15", "cost": 45.20, "tokens": 452000, "requests": 180}
    ]
  },
  "period": "30 days",
  "currency": "USD"
}
```

### Get Audit Logs

```http
GET /api/audit/logs?userId=123&days=7&requestType=deliberation
```

## 📊 Monitoring API

### Health Checks

```http
GET /health
```

Response:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00Z",
  "version": "1.0.0",
  "uptime": 86400
}
```

```http
GET /health/db
```

Response:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00Z",
  "connection": "ok",
  "responseTime": 15
}
```

```http
GET /health/redis
```

Response:
```json
{
  "status": "healthy",
  "timestamp": "2024-01-15T10:30:00Z",
  "connection": "ok",
  "memory": "45MB"
}
```

## 🚨 Error Handling

All API endpoints return consistent error responses:

```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid request parameters",
    "details": {
      "field": "question",
      "issue": "Question is required"
    }
  }
}
```

Common error codes:
- `VALIDATION_ERROR`: Invalid request parameters
- `AUTHENTICATION_ERROR`: Invalid or missing authentication
- `AUTHORIZATION_ERROR`: Insufficient permissions
- `RATE_LIMIT_ERROR`: Too many requests
- `RESOURCE_NOT_FOUND`: Requested resource doesn't exist
- `INTERNAL_ERROR`: Server error
- `COST_LIMIT_ERROR`: Cost limits exceeded
- `PII_DETECTED`: Sensitive data detected

## 📝 Rate Limiting

API requests are rate-limited per user:
- Free tier: 100 requests/hour
- Pro tier: 1000 requests/hour
- Enterprise: Unlimited

Rate limit headers:
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 95
X-RateLimit-Reset: 1642694400
```

## 🔍 API Examples

### Complete Deliberation Flow

```bash
# 1. Authenticate
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "user@example.com", "password": "password"}' | \
  jq -r '.token')

# 2. Auto-route query
ROUTE_RESULT=$(curl -s -X POST http://localhost:3000/api/council/auto-route \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"question": "How should I structure my startup?"}')

# 3. Ask council with optimal summon
SUMMON=$(echo $ROUTE_RESULT | jq -r '.summon')
curl -s -X POST http://localhost:3000/api/ask \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"question\": \"How should I structure my startup?\", \"summon\": \"$SUMMON\"}"

# 4. Get cost breakdown
curl -s -X GET "http://localhost:3000/api/costs/breakdown?days=7" \
  -H "Authorization: Bearer $TOKEN"
```

### Streaming Deliberation

```javascript
const eventSource = new EventSource('/api/ask/stream', {
  method: 'POST',
  headers: {
    'Authorization': 'Bearer ' + token,
    'Content-Type': 'application/json'
  },
  body: JSON.stringify({
    question: 'What are the implications of quantum computing?',
    summon: 'research'
  })
});

eventSource.onmessage = (event) => {
  const data = JSON.parse(event.data);
  console.log('Event:', data.type, data);
};
```

## 📚 SDK Examples

### Node.js SDK

```javascript
import { AICouncil } from 'ai-council-sdk';

const council = new AICouncil({
  baseURL: 'http://localhost:3000',
  token: 'your-jwt-token'
});

// Ask council
const result = await council.ask({
  question: 'What are the benefits of renewable energy?',
  summon: 'environmental'
});

// Stream response
const stream = council.askStream({
  question: 'Explain machine learning',
  summon: 'educational'
});

for await (const event of stream) {
  console.log(event);
}

// Get cost breakdown
const costs = await council.getCostBreakdown({ days: 30 });
```

### Python SDK

```python
from ai_council import AICouncil

council = AICouncil(
    base_url='http://localhost:3000',
    token='your-jwt-token'
)

# Ask council
result = council.ask(
    question='What are the benefits of renewable energy?',
    summon='environmental'
)

# Get cost breakdown
costs = council.get_cost_breakdown(days=30)
```

## 🔧 Webhooks

Configure webhooks to receive real-time notifications:

```bash
curl -X POST http://localhost:3000/api/webhooks \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "url": "https://your-app.com/webhook",
    "events": ["council.completed", "cost.alert", "evaluation.completed"],
    "secret": "webhook-secret"
  }'
```

Webhook payload:
```json
{
  "event": "council.completed",
  "timestamp": "2024-01-15T10:30:00Z",
  "data": {
    "sessionId": "session-123",
    "userId": 123,
    "verdict": "Final council decision...",
    "metrics": {"totalTokens": 2500, "duration": 15000}
  }
}
```

---

## 📞 Support

For API support:
- Documentation: https://docs.ai-council.com
- GitHub Issues: https://github.com/ai-council/issues
- Email: api-support@ai-council.com
- Status Page: https://status.ai-council.com
