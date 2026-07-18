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
