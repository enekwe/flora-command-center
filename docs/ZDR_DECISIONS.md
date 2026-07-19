# ZDR Implementation Engineering Decisions

**Document Purpose:** Record autonomous engineering decisions made during ZDR roadmap implementation.

**Format:** `Story-ID | Decision | Rationale`

---

## Decision Log

### ZDR-E0-S1 | Empty Allow-List Behavior | 2026-07-18
**Decision:** When `failClosed` is true but `allowedProviders` array is empty, the system does NOT block requests. Empty array is treated as "no restrictions specified" rather than "block everything".

**Rationale:**
- Fail-safe behavior: prevents accidentally breaking all API calls if allow-list configuration is missing
- Explicit allow-list requirement would be better enforced at a higher level (tenant configuration validation)
- Aligns with "fail-closed on policy violation, not on misconfiguration" principle
- Alternative (blocking on empty) would require extensive validation in calling code

**Alternative Considered:** Throw EgressPolicyViolationError when allow-list is empty. Rejected because it shifts burden to every caller to validate configuration before calling PAL.

---

### ZDR-E0-S1 | Allow-List Scope | 2026-07-18
**Decision:** `allowedProviders` array contains provider names (e.g., `['anthropic', 'openai']`) not full provider:model keys.

**Rationale:**
- Simpler tenant configuration (allow/deny at provider level, not per-model)
- Matches common ZDR use case: "allow only self-hosted or contracted providers"
- Model-specific restrictions can be layered via separate routing rules if needed
- Reduces configuration complexity for ZDR tenants

---

### ZDR-E1-S1 | ContextSession scope | 2026-07-18
**Decision:** ContextSession is a per-request, in-memory abstraction. Not persisted to Redis or Mongo. Stale sessions force-disposed after 30 minutes.

**Rationale:** ZDR guarantee G3 requires Customer Code retention = 0 for ZDR tenants. Persisting to Redis would violate this. 30-minute max age prevents memory leaks from orphaned requests.

---

### ZDR-E1-S2 | Per-request key vs. per-session key | 2026-07-18
**Decision:** Each ContextSession generates a fresh 32-byte AES-256-GCM data key. Key destroyed (zeroized) on dispose, implementing crypto-erase.

**Rationale:** Per-request key ensures that even if a key were somehow leaked, it only decrypts one request's data. Per-session key would expose more data per compromise. Crypto-erase via key destruction is more reliable than data deletion.

---

### ZDR-E3-S1 | companyId optional on TokenUsageTracker | 2026-07-18
**Decision:** companyId is required on SessionHandoff (content-bearing) but optional on TokenUsageTracker (operational metadata).

**Rationale:** TokenUsageTracker existed before ZDR and has many documents without companyId. Making it optional allows gradual backfill. SessionHandoff is content-bearing (stores code snippets) so companyId is mandatory for G6 compliance. New documents always include companyId.

---

### ZDR-E4-S2 | Trust tier ordering | 2026-07-18
**Decision:** Trust tier hierarchy: self_hosted (3) > zdr_contracted (2) > standard_hosted (1). Provider must meet or exceed required level.

**Rationale:** Higher number = more trusted. Self-hosted is most trusted (code stays in perimeter). Standard hosted is least trusted (public cloud). This ordering allows ZDR tenants to require self_hosted while mixed tenants can accept zdr_contracted.

---

### ZDR-E5-S1 | OpenAI-compatible API for self-hosted | 2026-07-18
**Decision:** SelfHostedProvider uses OpenAI-compatible /v1/chat/completions API.

**Rationale:** vLLM, Ollama, and most inference servers expose OpenAI-compatible APIs. This maximizes compatibility with existing model serving infrastructure. Zero cost pricing reflects that in-perimeter inference has no API billing.

---

### ZDR-E7-S1 | Hash chain vs. Merkle tree | 2026-07-18
**Decision:** Simple linear hash chain (each entry links to previous hash) rather than a Merkle tree.

**Rationale:** Linear chain is simpler to implement and verify. Sufficient for tamper evidence since any modification breaks the chain from that point forward. Merkle tree would be needed for efficient partial verification, which isn't required for ZDR audit use case.

---

### ZDR-E9-S1 | Whitepaper location | 2026-07-18
**Decision:** ZDR whitepaper and DPA language are documentation-only artifacts, placed in docs/ZDR_WHITEPAPER.md.

**Rationale:** These are customer-facing compliance documents that will be reviewed by legal before publication. Code implementation is not needed; the technical controls that make the claims true are implemented across Epochs 0-7.

---

### ZDR-E12-S1 | Self-owned deployment scope | 2026-07-18
**Decision:** Self-owned deployment (customer VPC) is documented as an architecture reference but not code-implemented in this iteration.

**Rationale:** Customer VPC deployment requires infrastructure-as-code, Kubernetes manifests, and CI/CD pipeline configuration that lives in flora-devops. The microservice code is already container-ready; the deployment packaging is an infra concern tracked separately.

---

## Key Principles Applied

1. **Data Classification Adherence:** Maintain strict separation between Customer Code (hard-erased) and Operational Records (retained, code-free)
2. **Exception ZDR-EX-1:** Soft-delete remains default for all platform data; hard-erasure applies ONLY to Customer Code class
3. **Fail-Closed Default:** When in doubt, reject rather than route to unapproved endpoint
4. **Code-Free Operational Records:** All retained records must have code stripped via redaction before persistence
5. **Tenant Isolation:** Use `companyId` for content-bearing stores per Command Center convention
6. **Transaction Atomicity:** Multi-step operations use withTransaction wrapper per skills.md mandate

---

**Last Updated:** 2026-07-18
**Implementation Branch:** claude/flora-command-center-security-pc65bk
