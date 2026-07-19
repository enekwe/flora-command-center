# ZDR-E9-S2: Penetration Test Scope & Tracking

**Status:** Pending vendor procurement
**Date:** 2026-07-18

---

## Scope

### In-Scope Targets

| Target | Description | Trust Boundary |
|--------|-------------|----------------|
| flora-command-center API | REST/gRPC/GraphQL endpoints | Flora perimeter |
| Egress gate (PAL) | Provider routing + fail-closed logic | Egress boundary |
| Tenant isolation middleware | companyId enforcement on all stores | Cross-tenant boundary |
| ZDR audit ledger | Append-only tamper-evident ledger | Integrity boundary |
| Self-hosted inference endpoint | vLLM/Ollama in customer perimeter | Customer perimeter |
| Secret detection pipeline | Redaction + pre-flight scan | Data boundary |
| Encryption layer | AES-256-GCM per-request keys | Crypto boundary |
| OAuth flows (Slack/Gmail) | Token storage and refresh | Integration boundary |

### Out-of-Scope

- Third-party LLM provider APIs (Anthropic, OpenAI, Google) — covered by their own SOC 2
- Railway infrastructure — covered by Railway's security program
- MongoDB Atlas — covered by MongoDB's security program

---

## ZDR-Specific Test Cases

### G1 — In Transit
- TLS version and cipher suite validation on all egress connections
- Certificate pinning verification for provider endpoints

### G2 — At Rest
- Verify per-request encryption keys are destroyed after dispose
- Attempt to recover code from MongoDB after session end (ZDR tenants)
- Verify no plaintext code in Redis cache entries

### G3 — Retention
- Verify artifact purge deletes files within configured TTL
- Verify no code in disk artifacts after purge cycle
- Time-to-deletion measurement for ZDR tenant code

### G4 — Redaction
- Fuzz test: inject 1000+ secret patterns, verify all redacted before egress
- Verify high-entropy detection catches novel secret formats
- Verify pre-flight scan blocks at threshold=1

### G5 — Egress Control
- Attempt to route code to standard_hosted provider for ZDR tenant (should fail-closed)
- Attempt to bypass trust-tier filtering via direct provider config manipulation
- Verify fallback chain respects allow-list

### G6 — Tenant Isolation
- Attempt cross-tenant read via sessionId enumeration
- Attempt cross-tenant write via handoff creation with wrong companyId
- SQL injection / NoSQL injection on companyId filter

### G7 — Observability
- Grep all log files for Customer Content fields (CI check)
- Verify no code in Prometheus metrics labels
- Verify no code in error stack traces

### G8 — Provability
- Tamper with audit ledger entry, verify chain integrity detection
- Forge attestation signature without HMAC key
- Replay old attestation for a different session

---

## Acceptance Criteria

- [ ] All G1–G8 test cases executed
- [ ] No critical or high findings unresolved
- [ ] Medium findings have remediation plan with timeline
- [ ] Report delivered to tech lead and security team
- [ ] Findings tracked in Linear for remediation

---

## Vendor Requirements

- SOC 2 Type II certified or equivalent
- Experience with multi-tenant SaaS architectures
- Experience with AI/LLM integration security
- Ability to test against production-like staging environment
- Report delivery within 4 weeks of engagement start
