# Flora Command Center — Zero Data Retention (ZDR) Whitepaper

**Status:** Draft (pending legal review)
**Version:** 1.0
**Date:** 2026-07-18

---

## Executive Summary

Flora Command Center implements Zero Data Retention (ZDR) to ensure that customer source code is never retained by Flora's infrastructure beyond the request/session lifecycle. This document describes the technical controls, data flows, and compliance guarantees that make this claim provable.

---

## ZDR Guarantees

| Guarantee | Definition |
|-----------|-----------|
| **G1 — In Transit** | TLS 1.2+ to every model/storage endpoint. No plaintext egress. |
| **G2 — At Rest** | Customer Code is never persisted in plaintext. If persisted (non-ZDR), encrypted under a per-request ephemeral key destroyed at request end. |
| **G3 — Retention** | Customer Code purged within the request lifecycle. Default retention for ZDR tenants = 0. |
| **G4 — Redaction** | Secrets and PII removed before egress to any external model and before any Operational Record is persisted. |
| **G5 — Egress Control** | Customer Code transmitted only to self-hosted or ZDR-contracted endpoints. All others rejected (fail-closed). |
| **G6 — Tenant Isolation** | No cross-tenant read or persistence. Every store scoped by companyId. |
| **G7 — Observability Hygiene** | No Customer Code in logs, metrics, telemetry, or analytics. |
| **G8 — Provability** | Per-request tamper-evident audit ledger entry. Customer-visible deletion attestation. |

---

## Data Classification

| Class | Scope | Retention | Treatment |
|-------|-------|-----------|-----------|
| **Customer Code** | Source code, snippets, repo structure, code in prompts | 0 (ZDR) / bounded (non-ZDR) | Hard-erased via crypto-erase at session end |
| **Operational Records** | Prompt/response metadata, redaction counts, audit logs, telemetry | Per platform policy | Retained code-free (redaction strips code before persist) |

---

## Architecture

```
Request → [Tenant Guard] → [Ephemeral Context Engine] → [Redaction/Secret-Detect] →
         companyId scope    in-mem, per-request key       enforced pre-egress
                                                                │
                                                     [Trust-Tier Egress Gate] → fail-closed
                                                                │
                             ┌──────────────────────────────────┼──────────────────┐
                      self-hosted (vLLM/Ollama)        ZDR-contracted hosted    REJECT
                       in customer/Flora perimeter     (opt-in per tenant)
                                                                │
                                                     [ZDR Audit Ledger] → purge + attestation → UI
```

---

## Trust Tiers

| Tier | Description | ZDR Eligible |
|------|-------------|-------------|
| `self_hosted` | Runs inside customer/Flora perimeter | Yes |
| `zdr_contracted` | Hosted API with contractual zero-retention | Yes (opt-in) |
| `standard_hosted` | Public cloud API (Anthropic, OpenAI, etc.) | No |

---

## Sub-Processor List

| Provider | Service | Trust Tier | Data Residency |
|----------|---------|-----------|----------------|
| Self-Hosted (vLLM/Ollama) | In-perimeter inference | self_hosted | Customer perimeter |
| Anthropic | Claude API | standard_hosted / zdr_contracted | US |
| OpenAI | GPT API | standard_hosted / zdr_contracted | US |
| Google | Gemini API | standard_hosted | US |

---

## DPA Clause Set (Draft)

1. **Data Processing:** Flora processes Customer Code solely for the purpose of providing AI-assisted development services. Code is processed in-memory and never retained beyond the request lifecycle for ZDR tenants.

2. **Sub-Processing:** Flora shall not transmit Customer Code to any sub-processor outside the agreed trust tier without explicit customer consent.

3. **Deletion:** Upon session end, all Customer Code is cryptographically erased. Flora provides a signed attestation of deletion upon request.

4. **Audit:** Flora maintains a tamper-evident audit ledger recording all data handling events. Customers may access their audit log at any time.

5. **Breach Notification:** Flora shall notify the customer within 72 hours of any security incident that may have exposed Customer Code.

---

## Retention Matrix

| Data Type | ZDR Tenant | Non-ZDR Tenant |
|-----------|-----------|----------------|
| Customer Code | 0 (crypto-erase) | Platform default (90 days soft-delete) |
| Prompt metadata | Platform default | Platform default |
| Audit ledger | Platform default | Platform default |
| Token telemetry | Platform default | Platform default |
| On-disk artifacts | Never written | 24h TTL then purged |

---

## Compliance Certifications (Planned)

- SOC 2 Type II (pending)
- Third-party ZDR architecture review (pending)
- Annual penetration test scoped to egress + retention boundaries
