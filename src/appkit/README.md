# Flora App Kit (Command Center module)

Command Center is the App Kit **project & audit system of record** and the
**runtime data broker** for apps the devops App Kit builds.

Full contract: [`../../APP_KIT_PROJECT_CONTRACT.md`](../../APP_KIT_PROJECT_CONTRACT.md).
Build engine: `flora-devops/FLORA_APP_KIT_ARCHITECTURE.md`.

## Layout

```
appkit/
├── models/
│   ├── AppKitToken.js         # scoped-token revocation registry
│   └── AppKitBuildLink.js     # project timeline of build phase transitions
├── services/
│   ├── appKitTokenService.js  # mint / verify / revoke scoped app tokens
│   └── appKitBrokerService.js # governed data broker (manifest + tenant + redact + audit)
└── routes/index.js            # /api/command-center/appkit
```

## Endpoints (mounted at `/api/command-center/appkit`)

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| `POST`   | `/status` | service key | Build phase callback → project timeline (`AppKitBuildLink`). |
| `POST`   | `/tokens` | service key | Mint a scoped app token (devops calls this at `deploying`). |
| `DELETE` | `/tokens/:buildId` | service key | Revoke a build's tokens (instant cutoff). |
| `POST`   | `/data` | scoped app token | Governed runtime data broker for built apps. |

## The broker guarantees (per `/data` call)

1. **Manifest enforcement** — the op's resource/access must be declared in the
   token's scope, else `403`.
2. **Tenant isolation** — an app may only reach its own company's data.
3. **Redaction** — `dataRedactionService` scrubs the response before it reaches the app.
4. **Authoritative fetch** — data comes only from the monolith via `monolithApiClient`.
5. **Audit** — every touch appends a `ZDRAuditLedger` entry (metadata only).

## Config (`config.appKit`)

```bash
APP_KIT_TOKEN_EXPIRATION=1h       # scoped-token lifetime
APP_KIT_BROKER_TRUST_TIER=self_hosted
APP_KIT_REDACT_BROKERED_DATA=true # outbound redaction on brokered data
APP_KIT_SERVICE_KEY=              # shared secret for the internal status/token endpoints
```

## Status

Skeleton: token mint/verify/revoke, the governed data broker, and the build-status
callback are implemented against Command Center's existing governance
(`dataRedactionService`, `ZDRAuditLedger`, `monolithApiClient`). ZDR-policy and
residency hooks are integration points to extend on the broker path.
