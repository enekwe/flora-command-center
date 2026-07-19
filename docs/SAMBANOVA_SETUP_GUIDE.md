# SambaNova Integration Guide for Flora ZDR

**Purpose:** Enable ZDR-compliant inference through SambaNova Cloud
**Trust Tier:** `zdr_contracted` (code doesn't reach OpenAI/Anthropic/Google)
**Status:** Ready for activation pending DPA

---

## Overview

SambaNova Cloud runs open-weight models (Llama 3.1, Qwen-Coder, DeepSeek-Coder) on their custom RDU chips with enterprise-grade compliance. This integration enables Flora to offer ZDR guarantees without operating GPU infrastructure.

**Benefits:**
- ✅ Zero data retention with contractual DPA
- ✅ Custom AI chips (not NVIDIA) - full stack control
- ✅ Open models (Llama, Qwen, DeepSeek)
- ✅ OpenAI-compatible API (drop-in replacement)
- ✅ SOC 2 / HIPAA certified
- ✅ Pay-per-token (no fixed GPU costs)

---

## Step 1: SambaNova Account Setup

### 1.1 Sign Up
1. Go to https://cloud.sambanova.ai
2. Click "Get Started" or "Request Access"
3. Choose **Enterprise** tier (required for DPA)
4. Fill out company information

### 1.2 Get API Key
1. Log into SambaNova Cloud dashboard
2. Navigate to "API Keys" section
3. Click "Create New API Key"
4. Copy the key (starts with `samba_...`)
5. Store securely in password manager

---

## Step 2: Negotiate DPA (Data Processing Agreement)

**Contact:** enterprise@sambanova.ai or your SambaNova account manager

**What to Request:**
1. **Zero-Retention Clause**
   - Prompts and responses deleted immediately after inference
   - No storage of customer data beyond request lifecycle
   - No caching of prompts/responses

2. **No Training Data Use**
   - Customer data never used to train or fine-tune models
   - No analytics or aggregation of customer prompts
   - Telemetry limited to operational metrics only

3. **Data Residency**
   - Confirm where inference runs (US datacenters preferred)
   - Document physical server locations
   - Confirm no cross-border data transfer

4. **Subprocessors**
   - List all subprocessors (cloud providers, CDNs, etc.)
   - Confirm same DPA terms apply to subprocessors
   - Right to audit compliance

5. **SLA Terms**
   - 99.9% uptime guarantee
   - Response time commitments
   - Compensation for breaches

6. **Security Certifications**
   - SOC 2 Type II report (request copy)
   - HIPAA compliance (if applicable)
   - ISO 27001 certification

**Expected Timeline:** 2-4 weeks for enterprise DPA negotiation

**Sample Language for DPA:**
```
SambaNova Cloud shall delete all Customer Data (prompts, responses, and associated metadata)
immediately upon completion of the inference request. Customer Data shall not be:
(a) retained beyond the request lifecycle,
(b) used for model training or improvement,
(c) shared with third parties, or
(d) aggregated for analytics purposes.

SambaNova shall provide deletion attestations upon request and allow Customer to audit
compliance with this zero-retention requirement.
```

---

## Step 3: Configure Flora

### 3.1 Set Environment Variables in Railway

In your `flora-command-center` service on Railway:

```bash
# Enable SambaNova
SAMBANOVA_ENABLED=true

# API Key (from Step 1.2)
SAMBANOVA_API_KEY=samba_your_actual_api_key_here

# API Endpoint (default, no need to change unless using dedicated instance)
SAMBANOVA_API_URL=https://api.sambanova.ai/v1

# DPA URL (add once DPA is signed)
SAMBANOVA_DPA_URL=https://yourstorage.com/sambanova-dpa.pdf
```

### 3.2 Create Provider Configuration in MongoDB

Connect to your MongoDB and insert the SambaNova provider config:

```javascript
// In MongoDB shell or Compass
use flora-command-center;

db.providerconfigs.insertOne({
  provider: 'sambanova',
  modelId: 'qwen-2.5-coder-32b',
  type: 'sambanova',
  enabled: true,

  // ZDR Configuration
  trustTier: 'zdr_contracted',
  residencyZone: 'sambanova_us',

  // API Settings
  apiKey: process.env.SAMBANOVA_API_KEY, // Will be resolved from env
  baseURL: 'https://api.sambanova.ai/v1',
  timeout: 120000,

  // Model Configuration
  contextWindow: 32768,
  maxTokens: 8192,
  temperature: 0.7,

  // Cost (update based on your SambaNova contract)
  costPerMToken: {
    input: 0.40,
    output: 0.40
  },

  // Routing
  priority: 1, // High priority for ZDR tenants
  capabilities: ['code', 'chat', 'completion'],

  // Health Check
  healthCheckEnabled: true,
  healthCheckInterval: 60000,

  createdAt: new Date(),
  updatedAt: new Date()
});

// Also add Llama 3.1 70B for general tasks
db.providerconfigs.insertOne({
  provider: 'sambanova',
  modelId: 'llama-3.1-70b',
  type: 'sambanova',
  enabled: true,
  trustTier: 'zdr_contracted',
  residencyZone: 'sambanova_us',
  contextWindow: 128000,
  maxTokens: 8192,
  costPerMToken: { input: 0.60, output: 0.60 },
  priority: 2,
  capabilities: ['chat', 'reasoning', 'code'],
  createdAt: new Date(),
  updatedAt: new Date()
});
```

### 3.3 Update ZDR Policy for Target Tenants

For each tenant that should use SambaNova:

```javascript
// Via ZDR Policy Engine API
POST /api/v1/zdr/policy

{
  "companyId": "company_abc123",
  "policy": {
    "requiredTrustTier": "zdr_contracted", // Allows SambaNova
    "allowedProviders": ["sambanova"], // Explicit allow-list
    "failClosed": true,
    "hardEraseEnabled": true,
    "retentionSeconds": 0
  }
}
```

---

## Step 4: Test Integration

### 4.1 Health Check

```bash
curl -X GET https://your-flora-command-center.railway.app/api/v1/providers/sambanova/health \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN"

# Expected response:
{
  "status": "healthy",
  "provider": "sambanova",
  "trustTier": "zdr_contracted",
  "modelsAvailable": 5
}
```

### 4.2 Test Inference

```bash
curl -X POST https://your-flora-command-center.railway.app/api/v1/chat/completions \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN" \
  -H "X-Company-ID: company_abc123" \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [
      {"role": "user", "content": "Write a Python function to reverse a string"}
    ],
    "model": "qwen-2.5-coder-32b",
    "temperature": 0.7
  }'

# Should route to SambaNova and return code
```

### 4.3 Verify Audit Trail

```bash
curl -X GET https://your-flora-command-center.railway.app/api/v1/zdr/audit/ledger?companyId=company_abc123 \
  -H "Authorization: Bearer YOUR_AUTH_TOKEN"

# Expected response includes:
{
  "entries": [
    {
      "eventType": "model_inference",
      "metadata": {
        "provider": "sambanova",
        "trustTier": "zdr_contracted",
        "model": "qwen-2.5-coder-32b",
        "endpoint": "https://api.sambanova.ai/v1/chat/completions"
      }
    }
  ]
}
```

---

## Step 5: Production Rollout

### 5.1 Pilot Phase (Week 1-2)
1. Enable for 2-3 friendly ZDR customers
2. Monitor error rates, latency, quality
3. Gather feedback on code generation quality
4. Verify DPA compliance (no data retention)

### 5.2 General Availability (Week 3+)
1. Update marketing: "ZDR-compliant AI with SambaNova"
2. Enable for all ZDR tier customers
3. Add to pricing page with per-token costs
4. Train support team on SambaNova features

---

## Pricing & Cost Management

### SambaNova Pricing (Estimated)

| Model | Input (per 1M tokens) | Output (per 1M tokens) | Use Case |
|-------|----------------------|------------------------|----------|
| Qwen 2.5 Coder 32B | $0.40 | $0.40 | Code generation (recommended) |
| Llama 3.1 70B | $0.60 | $0.60 | General chat, reasoning |
| DeepSeek Coder 33B | $0.35 | $0.35 | Code completion |
| Llama 3.1 8B | $0.20 | $0.20 | Fast, simple tasks |

### Flora Markup Strategy

**Option A: Fixed Markup**
- Charge 2x SambaNova cost
- Example: Qwen Coder at $0.80/M tokens (50% margin)

**Option B: Tiered Pricing**
- Free tier: $1.00/M tokens (subsidized)
- Pro tier: $0.60/M tokens (breakeven)
- Enterprise: Custom pricing (volume discounts)

**Option C: Bundled**
- Include X tokens/month in subscription
- Overage at $0.50/M tokens

### Cost Monitoring

Set up alerts in Railway:
```bash
# Alert when daily SambaNova spend exceeds $100
SAMBANOVA_DAILY_BUDGET=100

# Alert when tenant exceeds quota
SAMBANOVA_TENANT_QUOTA_GB=10
```

---

## Troubleshooting

### Issue: API Key Invalid
**Symptom:** 401 Unauthorized errors
**Solution:**
1. Check `SAMBANOVA_API_KEY` is set correctly in Railway
2. Verify key hasn't been rotated in SambaNova dashboard
3. Test key directly: `curl -H "Authorization: Bearer $SAMBANOVA_API_KEY" https://api.sambanova.ai/v1/models`

### Issue: Rate Limiting
**Symptom:** 429 Too Many Requests
**Solution:**
1. Check your SambaNova contract rate limits
2. Implement request queuing in PAL
3. Contact SambaNova to increase limits

### Issue: Slow Response Times
**Symptom:** Requests taking >10 seconds
**Solution:**
1. Check SambaNova status page: https://status.sambanova.ai
2. Verify model choice (8B faster than 70B)
3. Reduce `max_tokens` if generating very long responses
4. Consider adding caching layer

### Issue: Quality Lower Than Expected
**Symptom:** Code generation quality below OpenAI/Anthropic
**Solution:**
1. Try different temperature (0.3-0.7 for code)
2. Use Qwen-Coder instead of Llama for code tasks
3. Adjust system prompt for better context
4. Consider hybrid approach: SambaNova for simple tasks, self-hosted for complex

---

## Security Checklist

Before going to production:

- [ ] DPA signed with SambaNova
- [ ] DPA uploaded to secure storage (S3, Vault)
- [ ] DPA URL set in `SAMBANOVA_DPA_URL` env var
- [ ] API key stored in Railway secrets (not committed to git)
- [ ] Test data sent to SambaNova (verify deletion)
- [ ] Audit logs capturing all SambaNova requests
- [ ] Customer can see SambaNova in transparency UI
- [ ] Support team trained on ZDR + SambaNova
- [ ] Runbook for SambaNova outages documented

---

## Support & Documentation

**SambaNova Resources:**
- Dashboard: https://cloud.sambanova.ai
- API Docs: https://docs.sambanova.ai
- Status Page: https://status.sambanova.ai
- Support: enterprise@sambanova.ai

**Flora Resources:**
- Provider Code: `src/services/providers/sambanovaProvider.js`
- Config: `src/config/providers/sambanova.js`
- Tests: `test/integration/zdr/sambanova.test.js` (to be created)
- ZDR Docs: `docs/ZDR_IMPLEMENTATION_COMPLETE.md`

---

## Next Steps

1. **Week 1:** Contact SambaNova, request enterprise account
2. **Week 2:** Negotiate DPA, get API key
3. **Week 3:** Configure in Railway, test with pilot customers
4. **Week 4:** Roll out to all ZDR customers
5. **Ongoing:** Monitor quality, costs, compliance

**Once Complete:** Flora can credibly claim "Your code runs on ZDR-compliant infrastructure, never reaching OpenAI/Anthropic/Google."

---

**Status:** 🟡 Ready for activation (pending DPA)
**Last Updated:** 2026-07-18
**Owner:** Flora Security Team
