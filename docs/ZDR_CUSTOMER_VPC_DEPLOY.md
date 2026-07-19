# ZDR-E12-S1: Customer VPC Deployment Architecture

**Status:** Architecture reference (pending flora-devops IaC implementation)
**Date:** 2026-07-18

---

## Overview

For ZDR tenants requiring maximum data sovereignty, Flora Command Center can be deployed entirely within the customer's own VPC. This document describes the architecture, components, and deployment process.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                    Customer VPC                              │
│                                                              │
│  ┌────────────────────┐    ┌──────────────────────────────┐ │
│  │ flora-command-center│───▶│ Self-Hosted Inference (vLLM) │ │
│  │ (ECS/EKS pod)       │    │ (GPU instance)               │ │
│  └────────┬───────────┘    └──────────────────────────────┘ │
│           │                                                  │
│  ┌────────▼───────────┐    ┌──────────────────────────────┐ │
│  │ MongoDB (Atlas/      │    │ Redis (ElastiCache)          │ │
│  │  DocumentDB)         │    │                              │ │
│  └────────────────────┘    └──────────────────────────────┘ │
│                                                              │
│  ┌────────────────────┐                                     │
│  │ Neo4j (Knowledge    │                                     │
│  │  Graph)             │                                     │
│  └────────────────────┘                                     │
└──────────────────────────────────────────────────────────────┘
         │
         │ (TLS, read-only for non-ZDR features)
         ▼
┌─────────────────────────────────────────────────────────────┐
│                    Flora Cloud                               │
│  flora-mcp-server  │  flora-email-service  │  Admin Portal   │
└──────────────────────────────────────────────────────────────┘
```

---

## Components

| Component | Deployment | ZDR Role |
|-----------|-----------|----------|
| flora-command-center | ECS Fargate / EKS pod in customer VPC | Core ZDR service — all egress stays in perimeter |
| Self-hosted inference | GPU EC2 / EKS with NVIDIA device plugin | In-perimeter LLM — no code leaves customer VPC |
| MongoDB | Atlas dedicated cluster / DocumentDB | Stores operational records only (no code for ZDR) |
| Redis | ElastiCache in customer VPC | Session cache, rate limit counters |
| Neo4j | AuraDB / self-hosted | Knowledge graph for requirements traceability |
| flora-mcp-server | Flora cloud (connects via TLS) | MCP bridge — only sends metadata, not code |

---

## Network Architecture

### Ingress
- Customer API gateway → flora-command-center (internal ALB)
- IDE/CLI MCP clients → flora-mcp-server (Flora cloud) → flora-command-center (customer VPC via VPC peering or Transit Gateway)

### Egress (ZDR — no external egress for code)
- flora-command-center → self-hosted inference (internal VPC, no internet)
- flora-command-center → MongoDB (internal VPC)
- flora-command-center → Redis (internal VPC)

### Controlled Egress (non-ZDR features only)
- flora-command-center → Flora cloud API (TLS, metadata only — no Customer Code)
- OAuth callbacks for Slack/Gmail integrations

---

## Deployment Process

### Prerequisites
1. Customer provisions VPC with private subnets
2. GPU instance available (A10G minimum for 32B models)
3. MongoDB and Redis provisioned
4. IAM roles with least-privilege access

### Step 1: Infrastructure Provisioning
```bash
# Terraform (customer-provided VPC)
terraform init
terraform apply -var-file="customer-zdr.tfvars"
```

### Step 2: Deploy Inference
```bash
# Deploy vLLM with Qwen-Coder-32B
kubectl apply -f manifests/inference/
```

### Step 3: Deploy Command Center
```bash
# Deploy flora-command-center with ZDR config
kubectl apply -f manifests/command-center/
```

### Step 4: Configure
```bash
# Set ZDR environment variables
SELF_HOSTED_ENDPOINT=http://flora-inference.customer-perimeter.internal:8000
SELF_HOSTED_MODEL=qwen-coder-32b
ZDR_TENANT_IDS=<customer-company-id>
ZDR_HARD_ERASE_ENABLED=false  # ZDR-EX-1 gate
ROUTING_FAIL_CLOSED=true
```

### Step 5: Validate
```bash
# Verify self-hosted provider is healthy
curl $SELF_HOSTED_ENDPOINT/v1/models

# Verify ZDR policy
curl -H "X-Company-Id: <customer-company-id>" \
  https://command-center.customer.internal/api/command-center/zdr/policy

# Verify no external egress
kubectl logs deployment/flora-command-center | grep -i "egress"
```

---

## Security Controls

| Control | Implementation |
|---------|----------------|
| Network isolation | Private subnets, no public internet access for inference |
| Encryption at rest | AES-256-GCM per-request keys + MongoDB encryption |
| Encryption in transit | TLS 1.2+ on all internal connections |
| Access control | IAM roles, K8s RBAC, network policies |
| Audit trail | ZDR audit ledger with hash chain |
| Secret management | AWS Secrets Manager / HashiCorp Vault |
| Monitoring | CloudWatch + ZDR log sanitizer (G7) |

---

## Limitations

- Slack/Gmail integrations require controlled egress to their APIs (OAuth tokens only, no Customer Code)
- flora-mcp-server remains in Flora cloud (sends metadata, not code)
- Admin portal access requires VPN or bastion host
- GPU provisioning may require capacity reservations
