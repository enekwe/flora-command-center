# Command Center Microservice Architecture

## Overview

The Command Center microservice follows proper microservices architecture by **communicating with the monolith via HTTP API calls** for shared resources, rather than duplicating models and business logic.

This approach provides:
- **Single Source of Truth**: Shared data managed by monolith
- **Loose Coupling**: Services communicate via HTTP APIs
- **Clear Boundaries**: Each service owns specific domain logic
- **Easier Maintenance**: Changes to shared models happen in one place
- **Better Scalability**: Services can scale independently

## Architecture Diagram

```
┌─────────────────────────────────────────┐
│   Flora Monolith Application            │
│                                          │
│  - Site Model & API                     │
│  - StudioCompany Model & API            │
│  - User Model & API                     │
│  - Notification Model & API             │
│  - PlatformIntegration Model & API      │
│  - Milestone Service & API              │
│                                          │
│  Endpoints:                              │
│  GET    /api/sites/:id                  │
│  PATCH  /api/sites/:id                  │
│  POST   /api/sites/:id/increment        │
│  GET    /api/companies/:id              │
│  PATCH  /api/companies/:id              │
│  POST   /api/companies/:id/increment... │
│  GET    /api/users/:id                  │
│  POST   /api/notifications              │
│  POST   /api/milestones/check           │
│  GET    /api/integrations/:id           │
│  GET    /api/integrations/count         │
└─────────────────────────────────────────┘
                    ▲
                    │ HTTP API Calls
                    │ (via monolithApiClient)
                    │
┌───────────────────┴─────────────────────┐
│   Command Center Microservice           │
│                                          │
│  Owns:                                   │
│  - ProviderConfig Model                 │
│  - ProviderRoutingRule Model            │
│  - SessionHandoff Model                 │
│  - TokenUsageTracker Model              │
│  - TokenUsageLog Model                  │
│  - SlackConnection Model                │
│  - GmailConnection Model                │
│  - Provider Services (anthropic, etc.)  │
│  - providerAbstractionLayer             │
│  - providerRoutingService               │
│  - tokenTrackingService                 │
│  - sessionHandoffService                │
│  - contextOptimizationService           │
│  - bestPracticesService                 │
│  - byokService                           │
│  - Integration Services (Slack, Gmail)  │
│                                          │
│  Depends on Monolith for:               │
│  - Site data                             │
│  - Company data                          │
│  - User data                             │
│  - Notifications                         │
│  - Milestones                            │
│  - Platform integrations count          │
└──────────────────────────────────────────┘
```

## Monolith API Client

### Location
`/src/clients/monolithApiClient.js`

### Features
- **Retry Logic**: Automatically retries failed requests (configurable)
- **Error Handling**: Comprehensive error logging and handling
- **Authentication**: Supports API key authentication
- **Timeouts**: Configurable request timeouts
- **Health Checks**: Can verify monolith connectivity

### Configuration

Environment variables:

```bash
# Required
MONOLITH_API_URL=http://localhost:3000

# Optional (with defaults)
MONOLITH_API_KEY=optional-api-key-for-authentication
MONOLITH_API_TIMEOUT=10000              # 10 seconds
MONOLITH_API_MAX_RETRIES=3              # Retry 3 times
MONOLITH_API_RETRY_DELAY=1000           # 1 second between retries
```

### API Methods

#### Site Operations
```javascript
// Get site with options
await monolithClient.getSite(siteId, {
  includeByokKey: true,    // Include encrypted BYOK API key
  populateCompany: true    // Populate company data
});

// Update site
await monolithClient.updateSite(siteId, updates);

// Increment site metrics atomically
await monolithClient.incrementSiteMetrics(siteId, {
  'metrics.totalTokensUsed': 100,
  'metrics.totalRequests': 1
});
```

#### Company Operations
```javascript
// Get company with options
await monolithClient.getCompany(companyId, {
  includeByokKey: true
});

// Update company
await monolithClient.updateCompany(companyId, updates);

// Increment company tokens
await monolithClient.incrementCompanyTokens(companyId, tokens);
```

#### User Operations
```javascript
// Get user by ID
await monolithClient.getUser(userId);

// Get users by criteria
await monolithClient.getUsers({ role: 'admin' });
```

#### Notification Operations
```javascript
// Create notification
await monolithClient.createNotification({
  userId,
  type: 'site_reassignment_nudge',
  title: 'Title',
  message: 'Message',
  data: { ... },
  actionUrl: '/path'
});
```

#### Milestone Operations
```javascript
// Check and update milestones
await monolithClient.checkMilestones(siteId);
```

#### Integration Operations
```javascript
// Get integration
await monolithClient.getIntegration(integrationId);

// Count site integrations
await monolithClient.countSiteIntegrations(siteId);
```

#### Health Check
```javascript
// Check if monolith is reachable
const isHealthy = await monolithClient.healthCheck();
```

## Services Updated

### 1. byokService.js
**Before**: Direct Mongoose model access to `Site` and `StudioCompany`

**After**: HTTP API calls via monolith client

**Changes**:
- `Site.findById()` → `monolithClient.getSite()`
- `StudioCompany.findById()` → `monolithClient.getCompany()`
- `company.save()` → `monolithClient.updateCompany()`

### 2. tokenTrackingService.js
**Before**: Direct Mongoose updates to `Site` and `StudioCompany`, direct calls to `milestoneService`

**After**: HTTP API calls via monolith client

**Changes**:
- `Site.findByIdAndUpdate()` → `monolithClient.incrementSiteMetrics()`
- `StudioCompany.findByIdAndUpdate()` → `monolithClient.incrementCompanyTokens()`
- `milestoneService.updateMilestones()` → `monolithClient.checkMilestones()`
- Added error handling to prevent token logging failures

## Models Removed

These models are now managed exclusively by the monolith:

- ❌ `src/models/Site.js` (deleted)
- ❌ `src/models/StudioCompany.js` (deleted)
- ❌ `src/models/User.js` (deleted)
- ❌ `src/models/Notification.js` (deleted)
- ❌ `src/models/PlatformIntegration.js` (deleted)

## Services Removed

These services are now provided by the monolith via API:

- ❌ `src/services/milestoneService.js` (deleted)
- ❌ `src/services/notificationService.js` (deleted)

## Models Retained (Command Center Domain)

These models are specific to the Command Center microservice:

- ✅ `ProviderConfig.js` - AI provider configurations
- ✅ `ProviderRoutingRule.js` - Request routing rules
- ✅ `SessionHandoff.js` - Session handoff tracking
- ✅ `TokenUsageTracker.js` - Token usage tracking
- ✅ `TokenUsageLog.js` - Token usage logs
- ✅ `SlackConnection.js` - Slack workspace connections
- ✅ `GmailConnection.js` - Gmail account connections

## Error Handling

All monolith API calls include proper error handling:

### Retry Logic
- Network errors and 5xx errors are automatically retried
- Configurable retry count and delay
- Exponential backoff can be implemented if needed

### Fallback Behavior
- Token tracking: Logs errors but continues (metrics update failure doesn't break token logging)
- Milestone checks: Logs errors but continues (milestone failure doesn't break token logging)
- BYOK service: Throws errors to prevent invalid credential usage

### Logging
All API calls are logged with:
- Request details (URL, method, parameters)
- Response status
- Error messages (if any)
- Retry attempts

## Testing Strategy

### Unit Tests
Mock the monolith API client in service tests:

```javascript
jest.mock('../clients/monolithApiClient');

describe('byokService', () => {
  it('should fetch site credentials', async () => {
    monolithClient.getSite.mockResolvedValue({
      _id: 'site123',
      tokenConfig: { mode: 'site_byok', ... }
    });

    const result = await byokService.getCredentials('site123');
    expect(result.provider).toBe('anthropic');
  });
});
```

### Integration Tests
Test actual API communication:

```javascript
describe('Monolith API Integration', () => {
  it('should communicate with monolith', async () => {
    const site = await monolithClient.getSite('test-site-id');
    expect(site).toHaveProperty('_id');
  });
});
```

## Deployment Considerations

### Environment Setup
1. Set `MONOLITH_API_URL` to point to the monolith application
2. Configure authentication via `MONOLITH_API_KEY` if required
3. Adjust timeout/retry settings based on network latency

### Health Checks
The microservice should verify monolith connectivity on startup:

```javascript
const isHealthy = await monolithClient.healthCheck();
if (!isHealthy) {
  logger.warn('Monolith is not reachable, some features may be unavailable');
}
```

### Monitoring
Monitor these metrics:
- API call latency to monolith
- API call error rates
- Retry counts
- Failed requests after all retries

### Circuit Breaker (Future Enhancement)
Consider implementing a circuit breaker pattern if the monolith becomes unavailable frequently.

## Migration Checklist

- [x] Create monolith API client
- [x] Update byokService to use API client
- [x] Update tokenTrackingService to use API client
- [x] Delete duplicated models
- [x] Delete duplicated services
- [x] Update environment configuration
- [x] Document architecture changes
- [ ] Add integration tests
- [ ] Update deployment scripts
- [ ] Monitor production performance

## Future Improvements

1. **Caching**: Cache frequently accessed data (sites, companies) with TTL
2. **Circuit Breaker**: Implement circuit breaker for resilience
3. **GraphQL**: Consider GraphQL for more flexible data fetching
4. **Event Sourcing**: Use events instead of synchronous API calls for non-critical updates
5. **Service Mesh**: Use service mesh (e.g., Istio) for advanced routing and resilience

## Benefits Achieved

### 1. Single Source of Truth
- Site, Company, User, Notification data managed in one place
- No data synchronization issues
- Consistent business logic

### 2. Clear Service Boundaries
- Command Center owns AI provider logic
- Monolith owns core business entities
- Easy to reason about responsibilities

### 3. Independent Scalability
- Scale Command Center based on AI request load
- Scale monolith based on user/site management load
- Optimize each service independently

### 4. Easier Maintenance
- Model schema changes happen once
- Business logic changes happen once
- Reduced code duplication

### 5. Better Testing
- Services can be tested independently
- Mock API calls for unit tests
- Clear integration test boundaries

## Trade-offs

### Network Latency
- **Before**: Direct database access (microseconds)
- **After**: HTTP API call (milliseconds)
- **Mitigation**: Caching, batch operations, async updates

### Complexity
- **Before**: Direct model access
- **After**: API client + error handling + retries
- **Mitigation**: Well-designed client abstracts complexity

### Dependencies
- **Before**: Shared database schema
- **After**: API contract dependency
- **Mitigation**: API versioning, backward compatibility

## Conclusion

This refactoring transforms the Command Center from a duplicated monolith to a proper microservice. By communicating with the monolith via HTTP APIs for shared resources, we achieve better separation of concerns, easier maintenance, and true microservices architecture.
