# ZDR-E5-S3: Self-Hosted Inference Deploy Recipe

**Status:** Code-complete, pending infrastructure provisioning
**Date:** 2026-07-18

---

## Prerequisites

- GPU instance (minimum A10G / 24GB VRAM for 32B models)
- Kubernetes cluster or bare-metal server in customer/Flora perimeter
- Container runtime (Docker/Podman)
- Network access from flora-command-center to inference endpoint

---

## Option A: vLLM (Recommended for production)

### Container Deploy

```bash
docker run -d \
  --gpus all \
  --name flora-inference \
  -p 8000:8000 \
  -e MODEL_NAME=Qwen/Qwen2.5-Coder-32B-Instruct \
  -e GPU_MEMORY_UTILIZATION=0.9 \
  -e MAX_MODEL_LEN=32768 \
  vllm/vllm-openai:latest \
  --model $MODEL_NAME \
  --served-model-name qwen-coder-32b \
  --max-model-len $MAX_MODEL_LEN \
  --gpu-memory-utilization $GPU_MEMORY_UTILIZATION
```

### Kubernetes Manifest

```yaml
apiVersion: apps/v1
kind: Deployment
metadata:
  name: flora-inference
  labels:
    app: flora-inference
    trust-tier: self-hosted
spec:
  replicas: 1
  selector:
    matchLabels:
      app: flora-inference
  template:
    metadata:
      labels:
        app: flora-inference
    spec:
      containers:
      - name: vllm
        image: vllm/vllm-openai:latest
        args:
        - --model
        - Qwen/Qwen2.5-Coder-32B-Instruct
        - --served-model-name
        - qwen-coder-32b
        - --max-model-len
        - "32768"
        resources:
          limits:
            nvidia.com/gpu: 1
        ports:
        - containerPort: 8000
        env:
        - name: GPU_MEMORY_UTILIZATION
          value: "0.9"
        readinessProbe:
          httpGet:
            path: /v1/models
            port: 8000
          initialDelaySeconds: 120
          periodSeconds: 10
---
apiVersion: v1
kind: Service
metadata:
  name: flora-inference
spec:
  selector:
    app: flora-inference
  ports:
  - port: 8000
    targetPort: 8000
```

### Flora Command Center Configuration

```bash
# Set in Railway dashboard or .env
SELF_HOSTED_ENDPOINT=http://flora-inference.customer-perimeter.internal:8000
SELF_HOSTED_MODEL=qwen-coder-32b
SELF_HOSTED_API_KEY=              # Optional: if inference endpoint requires auth
SELF_HOSTED_TIMEOUT_MS=60000
```

---

## Option B: Ollama (Development / lightweight)

```bash
ollama pull qwen2.5-coder:32b
ollama serve  # Exposes :11434
```

```bash
SELF_HOSTED_ENDPOINT=http://localhost:11434/v1
SELF_HOSTED_MODEL=qwen2.5-coder:32b
```

---

## Validation Checklist

- [ ] `curl $SELF_HOSTED_ENDPOINT/v1/models` returns model list
- [ ] `curl $SELF_HOSTED_ENDPOINT/health` returns 200
- [ ] Test inference: `curl $SELF_HOSTED_ENDPOINT/v1/chat/completions -d '{"model":"qwen-coder-32b","messages":[{"role":"user","content":"hello"}]}'`
- [ ] flora-command-center health check shows self_hosted provider as configured
- [ ] ZDR audit ledger records trustTier=self_hosted for requests routed to this endpoint
