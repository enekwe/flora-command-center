# Flora App Kit — Command Center Project & Data-Broker Contract

**Status:** Skeleton implemented — see `src/appkit/` (scoped-token mint/verify/revoke,
the governed `/appkit/data` broker, and the `/appkit/status` build-callback sink).
**Owning service:** `flora-command-center` (the Project & Collaboration plane)
**Companion doc:** `flora-devops/FLORA_APP_KIT_ARCHITECTURE.md` (the build engine)

---

## 1. Role of Command Center in App Kit

Command Center is the **system of record** for App Kit work. It owns:

- **The project / workspace** — multiplayer file access, history, and the
  natural-language intake conversation from which an app request is born.
- **The audit log** — every phase of a build and every data touch by the resulting
  app is recorded here. CC already carries the audit primitives: `ZDRAuditLedger`,
  `TokenUsageLog`, `SessionHandoff`.
- **Governance** — `zdrPolicyEngine`, `dataRedactionService`, `dataResidencyService`,
  `tenantIsolation` middleware, and `byokService`.
- **The authoritative-data gateway** — `clients/monolithApiClient.js` is the only
  path to Sites, Companies, Users, Notifications, Milestones.

flora-devops **builds and deploys**; Command Center **owns the project, decides
data access, and records everything.** App Kit never moves the project out of CC.

## 2. The two contracts CC provides

### 2.1 Build intake & status (project → devops → project)

When a user's NL prompt in a CC project is classified as a **custom app**, CC hands
the request to App Kit in flora-devops via `POST /api/command-center/appkit/requests`
(implemented — see `src/appkit/routes/index.js`), which proxies to flora-devops's
`POST /api/appkit/builds` (companion doc §4.1) on the caller's behalf, using the
**real, existing** CC `projectId` — this keeps the project in CC. (A separate path,
flora-mcp-server's `app_kit/build` MCP tool, lets an IDE/CLI agent kick off a build
without a pre-existing CC project by minting an ad-hoc `projectId`; both paths
converge on the same `/status` callback below, so either way the build is fully
audited as a CC-tracked project.) App Kit calls back on each phase transition:

```
POST {callbackUrl}   (a CC endpoint, e.g. /api/command-center/appkit/status)
{
  "buildId": "akb_...",
  "projectId": "cc_proj_...",
  "requestId": "cc_req_...",          // → ZDRAuditLedger.requestId
  "phase": "integrity_testing",       // accepted|scaffolding|generating|
                                      //   integrity_testing|deploying|tracking|live|blocked
  "driftScore": 82,                   // present from `tracking` onward
  "deployUrl": "https://...",
  "repo": "enekwe/capital-call-tracker"
}
```

CC writes each transition to the **project timeline** and, for any phase that
consumed model tokens (`generating`), to `TokenUsageLog`. A `blocked` phase (failed
data-integrity tests) is surfaced in the project, not deployed.

### 2.2 Runtime data broker (built app → CC → monolith)

A live App Kit app never holds raw credentials or a DB handle. It calls a **scoped
broker endpoint** on CC. CC enforces the app's manifest, applies governance, calls
the monolith on the app's behalf, and audits the touch.

```
POST /api/command-center/appkit/data
Authorization: Bearer <scoped app token>      // minted per build; carries buildId + scopes
{
  "op": "getCompany",                          // must map to an allowed manifest scope
  "args": { "companyId": "cmp_..." }
}
```

Broker responsibilities on every call:

1. **Manifest check** — reject any `op`/resource the build did not declare.
2. **Tenant isolation** — enforce `userId` + `organizationId` via existing
   `tenantIsolation` middleware; an app can only reach its own org's data.
3. **Governance** — apply `zdrPolicyEngine` (hosting-class routing),
   `dataResidencyService`, and `dataRedactionService` before returning data.
4. **Authoritative fetch** — call `monolithApiClient` (`getCompany`, `getSite`,
   `incrementSiteMetrics`, `createNotification`, `checkMilestones`, …). The monolith
   stays the single source of truth.
5. **Audit** — write a `ZDRAuditLedger` row (`requestId`, `companyId`, provider
   `hostingClass`, `action`, `state: 'recorded'`) so every data touch is traceable
   to a project and build.

```
App Kit app ──scoped token──► CC /appkit/data ──► [manifest ✓ · tenant ✓ · ZDR/redaction ✓]
                                                        │
                                                        ├─► monolithApiClient ──► Flora monolith
                                                        └─► ZDRAuditLedger.record()
```

## 3. Scoped app token

- Minted by CC when a build reaches `deploying`, bound to `buildId`,
  `organizationId`, `userId`, and the manifest's `dataScopes`.
- Short-lived + refreshable; stored encrypted (reuse existing AES-256-GCM utility).
- Revocable per build — killing a build/app instantly revokes its data access.

## 4. What CC must add

- `POST /api/command-center/appkit/status` — build-callback sink → project timeline
  + `TokenUsageLog`.
- `POST /api/command-center/appkit/data` — the governed data broker described in §2.2.
- Scoped-app-token mint/verify/revoke (extends existing auth + encryption utils).
- Optional: an `AppKitProject`/link model tying a CC project to its `buildId`s. The
  audit trail itself reuses `ZDRAuditLedger` — no new audit store.

## 5. Non-goals for Command Center

- CC does **not** scaffold, generate repos, or deploy — that is flora-devops / App Kit.
- CC does **not** grant apps direct DB or monolith access — all access is brokered
  through §2.2 so it can be governed and audited.
