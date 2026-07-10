# Flora Command Center - Integration Structure

## Directory Tree

```
flora-command-center/
├── src/
│   ├── integrations/
│   │   ├── slack/
│   │   │   ├── models/
│   │   │   │   └── SlackConnection.js          (Multi-tenant model)
│   │   │   ├── services/
│   │   │   │   ├── slackAuthService.js         (OAuth + encryption)
│   │   │   │   ├── slackMessageService.js      (Message operations)
│   │   │   │   └── slackWorkspaceService.js    (Workspace management)
│   │   │   └── routes/
│   │   │       ├── index.js                    (Route aggregator)
│   │   │       ├── oauth.js                    (OAuth endpoints)
│   │   │       ├── messages.js                 (Message endpoints)
│   │   │       └── workspace.js                (Workspace endpoints)
│   │   │
│   │   └── gmail/
│   │       ├── models/
│   │       │   └── GmailConnection.js          (Multi-tenant model)
│   │       ├── services/
│   │       │   ├── gmailAuthService.js         (OAuth + encryption)
│   │       │   ├── gmailSyncService.js         (Email operations)
│   │       │   └── gmailLabelService.js        (Label management)
│   │       └── routes/
│   │           ├── index.js                    (Route aggregator)
│   │           ├── oauth.js                    (OAuth endpoints)
│   │           ├── messages.js                 (Message endpoints)
│   │           └── sync.js                     (Sync + label endpoints)
│   │
│   ├── utils/
│   │   └── encryption.js                       (AES-256-GCM encryption)
│   │
│   └── index.js                                (Main app - routes mounted)
│
├── test-integrations.js                        (Test suite)
├── .env.example                                (Environment template)
└── package.json                                (Dependencies)
```

## Code Statistics

- **Total Files**: 16 integration files + 1 utility
- **Total Lines of Code**: 5,548
- **Models**: 2 (SlackConnection, GmailConnection)
- **Services**: 6 (3 Slack, 3 Gmail)
- **Route Files**: 8 (4 Slack, 4 Gmail)

## Architecture Layers

### Layer 1: Models (Database Schema)
```
SlackConnection      GmailConnection
      ↓                    ↓
   MongoDB              MongoDB
```

**Responsibilities**:
- Define schema with userId + organizationId
- Encrypted token storage (select: false)
- Instance methods (markActive, markDisconnected, etc.)
- Static methods (findActiveConnection, findWithTokens, etc.)

### Layer 2: Services (Business Logic)
```
Auth Services         Operation Services
     ↓                       ↓
slackAuthService      slackMessageService
gmailAuthService      slackWorkspaceService
                      gmailSyncService
                      gmailLabelService
```

**Responsibilities**:
- OAuth flow management
- Token encryption/decryption
- API client initialization
- Business logic for operations
- Error handling

### Layer 3: Routes (HTTP Endpoints)
```
/api/integrations/slack/*
     ↓
  oauth.js
  messages.js
  workspace.js

/api/integrations/gmail/*
     ↓
  oauth.js
  messages.js
  sync.js
```

**Responsibilities**:
- HTTP request validation
- Call service layer
- Return formatted responses
- Error handling

## Data Flow

### OAuth Flow
```
1. User → Frontend → GET /slack/connect
                         ↓
2. slackAuthService.getAuthorizationUrl()
                         ↓
3. Generate encrypted state (userId + orgId)
                         ↓
4. Return Slack OAuth URL → User clicks → Slack authorization
                         ↓
5. Slack → GET /slack/callback?code=XXX&state=YYY
                         ↓
6. slackAuthService.exchangeCodeForToken()
                         ↓
7. Decrypt state, validate timestamp
                         ↓
8. Exchange code for tokens
                         ↓
9. Encrypt tokens with AES-256-GCM
                         ↓
10. Save to MongoDB (SlackConnection)
                         ↓
11. Redirect to frontend success page
```

### API Request Flow
```
1. Frontend → POST /slack/messages/send
                 {connectionId, channel, text}
                         ↓
2. slackMessageService.sendMessage()
                         ↓
3. slackAuthService.getAccessToken(connectionId)
                         ↓
4. Find connection in MongoDB (with tokens)
                         ↓
5. Decrypt access token
                         ↓
6. Initialize Slack WebClient
                         ↓
7. Make API call to Slack
                         ↓
8. Return result to frontend
```

## Security Architecture

### Token Encryption
```
Plain Token
    ↓
AES-256-GCM Encryption
    ├── 256-bit key (from ENCRYPTION_KEY env var)
    ├── Random 128-bit IV
    ├── Random 512-bit salt
    └── 128-bit auth tag
    ↓
Base64 Encoded
    ↓
Stored in MongoDB
```

### Multi-Tenant Isolation
```
Connection Document {
  userId: "507f1f77bcf86cd799439011",
  organizationId: "507f191e810c19729de860ea",
  ...
}

Indexes:
- {organizationId: 1, teamId: 1} UNIQUE
- {userId: 1, organizationId: 1}
- {organizationId: 1, status: 1}
```

## Endpoint Summary

### Slack (20 endpoints)
- OAuth: 6 endpoints
- Messages: 14 endpoints
- Workspace: 16 endpoints

### Gmail (23 endpoints)
- OAuth: 7 endpoints
- Messages: 12 endpoints
- Sync/Labels: 10 endpoints

## Testing

### Test Coverage
```
✓ Encryption/Decryption
✓ State parameter encryption
✓ OAuth URL generation (Slack)
✓ OAuth URL generation (Gmail)
✓ Token encryption methods
✓ Model structure validation
✓ Syntax validation (all files)
```

### Manual Testing Required
- [ ] End-to-end OAuth flow with real credentials
- [ ] Token refresh (Gmail)
- [ ] API operations with real connections
- [ ] Multi-tenant isolation verification
- [ ] Error handling edge cases

## Dependencies

### NPM Packages
```json
{
  "@slack/web-api": "^6.x.x",
  "googleapis": "^131.x.x",
  "mongoose": "^7.5.0",
  "express": "^4.18.2"
}
```

### Built-in Node.js
```javascript
const crypto = require('crypto');  // For encryption
const axios = require('axios');     // For OAuth token exchange
```

## Configuration

### Environment Variables
```bash
# Required
ENCRYPTION_KEY=<64-char-hex>
MONGODB_URI=mongodb://...
SLACK_CLIENT_ID=<slack-client-id>
SLACK_CLIENT_SECRET=<slack-client-secret>
GOOGLE_CLIENT_ID=<google-client-id>
GOOGLE_CLIENT_SECRET=<google-client-secret>

# Optional (with defaults)
PORT=4000
FRONTEND_URL=http://localhost:3000
SLACK_REDIRECT_URI=http://localhost:4000/api/integrations/slack/callback
GOOGLE_REDIRECT_URI=http://localhost:4000/api/integrations/gmail/callback
```

## Production Deployment Checklist

- [ ] Set ENCRYPTION_KEY (generate with crypto.randomBytes(32).toString('hex'))
- [ ] Configure Slack OAuth credentials
- [ ] Configure Google OAuth credentials
- [ ] Set up MongoDB connection
- [ ] Configure CORS_ORIGIN for production domain
- [ ] Set FRONTEND_URL to production domain
- [ ] Update redirect URIs in Slack/Google consoles
- [ ] Test OAuth flows in production environment
- [ ] Monitor token refresh jobs (Gmail)
- [ ] Set up logging and error tracking

## Common Operations

### Generate Encryption Key
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

### Run Tests
```bash
ENCRYPTION_KEY="<64-char-hex>" node test-integrations.js
```

### Start Server
```bash
npm start
# or
npm run dev  # with nodemon
```

### Check Syntax
```bash
node -c src/index.js
node -c src/integrations/slack/routes/index.js
node -c src/integrations/gmail/routes/index.js
```

## Troubleshooting

### "ENCRYPTION_KEY not set"
- Set ENCRYPTION_KEY environment variable
- Must be 32 bytes (64 hex characters)

### "MongoDB connection failed"
- Check MONGODB_URI is set and correct
- Ensure MongoDB is running

### "OAuth error: invalid_client"
- Verify CLIENT_ID and CLIENT_SECRET are correct
- Check redirect URI matches configured value

### "Slack connection not found"
- Ensure connectionId is valid
- Check connection exists in database
- Verify connection status is 'active'

### "Gmail access token expired"
- Token refresh should happen automatically
- Manually call POST /api/integrations/gmail/refresh

## Support

For issues or questions:
1. Check PHASE_2_IMPLEMENTATION_REPORT.md
2. Review CORRECTED_MICROSERVICES_PLAN.md
3. Check test-integrations.js for examples
4. Review inline code documentation
