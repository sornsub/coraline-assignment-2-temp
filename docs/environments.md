# Environment Strategy

This document explains how the platform separates dev, staging, and prod using Kustomize overlays.

---

## Overview

Each environment maps to a Git branch, a Kubernetes namespace, a set of overlay patches, and a distinct image tag. This ensures:

- Development changes cannot affect staging or production
- Each environment is independently validated before promotion
- Configuration differences are version-controlled alongside the application
- No environment-specific values are hardcoded in images or base manifests

---

## Environment Summary

| Environment | Branch | Namespace | Ingress host | Image tag | Purpose |
|---|---|---|---|---|---|
| dev | `dev` | `atlas-dev` | `atlas-dev.example.internal` | `:dev` | Active development, frequent deployments |
| staging | `staging` | `atlas-staging` | `atlas-staging.example.internal` | `:staging` | Pre-release integration testing |
| prod | `main` | `atlas-prod` | `atlas.example.internal` | `:prod` | Live internal users, high availability |

---

## Branch Mapping

```
Git branch:    dev  ──(PR)──►  staging  ──(PR + approval)──►  main
                  │                 │                               │
Environment:  dev              staging                          prod
Namespace:    atlas-dev        atlas-staging                   atlas-prod
Image tag:    :dev             :staging                        :prod
```

Branch-to-environment mapping is enforced by the CI/CD pipeline. A push to any branch triggers a pipeline run that tags images and documents the target environment. Promotion between environments always requires a pull request.

---

## Namespace Strategy

Each environment runs in an isolated Kubernetes namespace. Namespaces are applied by overlay patches on top of the base namespace definition.

| Namespace | Environment | Who manages it |
|---|---|---|
| `atlas-dev` | dev | Developers (frequent changes) |
| `atlas-staging` | staging | Platform team (controlled deploys) |
| `atlas-prod` | prod | Platform team (gated deploys) |

Namespace isolation provides:
- Independent RBAC policies per environment
- Independent `NetworkPolicy` enforcement
- The ability to tear down one environment without affecting others
- Clear audit boundaries for production access

In a production setup, each namespace may reside in a separate Kubernetes cluster for stronger blast radius containment.

Overlay patch file: `k8s/overlays/<env>/namespace-patch.yaml`

---

## Image Tag Strategy

Docker images are tagged with the target environment name:

| Image | dev | staging | prod |
|---|---|---|---|
| `ghcr.io/<org>/atlas-portal` | `:dev` | `:staging` | `:prod` |
| `ghcr.io/<org>/orion-api` | `:dev` | `:staging` | `:prod` |

Kustomize image patches in each overlay replace the base image reference with the correct environment tag. When a new image is pushed to GHCR, the GitOps controller detects the change and syncs the cluster — no manifest file needs to be updated.

> For production hardening, add an immutable SHA tag alongside the environment tag (e.g., `:prod-a3f8c12`) for rollback and audit traceability.

---

## Configuration Separation

Non-sensitive configuration values are stored in Kubernetes ConfigMaps and patched per environment by overlay.

**Base ConfigMap** (`k8s/base/configmap.yaml`):
```yaml
APP_ENV: base
API_URL: http://orion-api:8000
AIRFLOW_URL: http://airflow:8080
NOTEBOOK_URL: http://notebook-lab:8888
APACHE_WEB_URL: http://apache-web:80
GRAFANA_URL: https://grafana.example.internal
SERVICE_LINKS_JSON: <portal card definitions>
```

**Each overlay patches** (`k8s/overlays/<env>/config-patch.yaml`):

| Key | dev | staging | prod |
|---|---|---|---|
| `APP_ENV` | `dev` | `staging` | `prod` |
| `API_URL` | `http://dev-orion-api:8000` | `http://staging-orion-api:8000` | `http://prod-orion-api:8000` |
| `SERVICE_LINKS_JSON` | Dev-tier service URLs | Staging-tier service URLs | Prod-tier service URLs |

Each service reads its environment name and service URLs from the ConfigMap at startup. No environment-specific values are baked into the application image.

---

## Secret Separation

Secrets follow the same namespace isolation as config. Each namespace manages its own Kubernetes Secrets independently. Secrets are never committed to this repository.

| Environment | Secret management approach |
|---|---|
| dev | Developer-managed Kubernetes Secrets with placeholder values, or `kubectl create secret` locally |
| staging | Secrets injected by External Secrets Operator from a staging-tier secret store |
| prod | Secrets injected by External Secrets Operator from the production secret store; rotation policy enforced |

**Reference files in this repo (placeholders only):**
- `.env.example` — variable names for local `docker compose` development
- `k8s/base/secret-example.yaml` — shows the expected Kubernetes Secret structure

Applications reference secrets via `secretRef` in Deployment specs:
```yaml
envFrom:
  - secretRef:
      name: platform-secrets
      # value managed externally — not stored in this repository
```

---

## Deployment Differences by Environment

| Setting | dev | staging | prod |
|---|---|---|---|
| Replicas — atlas-portal | 1 | 1 | 3 |
| Replicas — orion-api | 1 | 1 | 3 |
| Replicas — airflow | 1 | 1 | 1 |
| CPU request — portal | 50m | 50m | 150m |
| CPU limit — portal | 250m | 250m | 500m |
| Memory request — portal | 64Mi | 64Mi | 128Mi |
| Memory limit — portal | 128Mi | 128Mi | 256Mi |
| CPU request — API | 50m | 50m | 200m |
| CPU limit — API | 300m | 300m | 1000m |
| Memory request — API | 96Mi | 96Mi | 256Mi |
| Memory limit — API | 256Mi | 256Mi | 512Mi |
| Ingress host | `atlas-dev.example.internal` | `atlas-staging.example.internal` | `atlas.example.internal` |

Resource differences are applied by overlay patch files:
- Replicas: `k8s/overlays/<env>/replicas-patch.yaml`
- Resources: `k8s/overlays/<env>/resources-patch.yaml`
- Ingress: `k8s/overlays/<env>/ingress-patch.yaml`

---

## Kustomize Overlay Structure

Kustomize uses a shared base layer plus environment-specific overlay patches. Each overlay contains only the values that differ from the base — nothing is duplicated.

```
k8s/
├── base/
│   ├── kustomization.yaml          # Lists all base resources
│   ├── namespace.yaml              # Base namespace (atlas-platform)
│   ├── configmap.yaml              # Shared config values
│   ├── secret-example.yaml         # Secret structure template (placeholder only)
│   ├── ingress.yaml                # Base ingress routes
│   ├── portal/
│   │   ├── deployment.yaml         # atlas-portal Deployment
│   │   ├── service.yaml
│   │   └── kustomization.yaml
│   ├── api/
│   │   ├── deployment.yaml         # orion-api Deployment
│   │   ├── service.yaml
│   │   └── kustomization.yaml
│   ├── airflow/
│   ├── apache-web/
│   └── notebook/
└── overlays/
    ├── dev/
    │   ├── kustomization.yaml      # References base; lists all patches
    │   ├── namespace-patch.yaml    # Namespace → atlas-dev; name prefix → dev-
    │   ├── config-patch.yaml       # APP_ENV=dev, dev-tier service URLs
    │   ├── replicas-patch.yaml     # 1 replica per service
    │   ├── resources-patch.yaml    # Dev-tier CPU and memory limits
    │   └── ingress-patch.yaml      # atlas-dev.example.internal
    ├── staging/                    # Same structure, staging values
    └── prod/                       # Same structure; 3 replicas for portal + API
```

**How Kustomize resolves an overlay:**

1. Reads `k8s/overlays/<env>/kustomization.yaml`
2. Loads all base resources listed in `k8s/base/kustomization.yaml`
3. Applies each patch file as a strategic merge patch
4. Produces a complete, environment-specific manifest set

No values are duplicated between overlays. If a setting is not patched, the base value applies.

**Validate without a cluster:**
```bash
kubectl kustomize k8s/overlays/dev
kubectl kustomize k8s/overlays/staging
kubectl kustomize k8s/overlays/prod
```

---

## Promotion Process

```
Step 1: Developer merges a change into the dev branch
         → CI runs: test + build + scan + validate
         → Images tagged :dev are pushed to GHCR
         → GitOps controller syncs atlas-dev namespace

Step 2: When dev is ready for staging:
         → Open a PR: dev → staging
         → CI runs the full pipeline on the PR (no image push)
         → Peer review and approval required
         → On merge: images tagged :staging are pushed
         → GitOps controller syncs atlas-staging namespace

Step 3: When staging is validated:
         → Open a PR: staging → main
         → CI runs the full pipeline on the PR (no image push)
         → Peer review + manual approval gate required
         → On approval and merge: images tagged :prod are pushed
         → GitOps controller syncs atlas-prod namespace
```

**Rules:**
- Every change must pass through dev and staging before reaching prod
- No environment can be skipped
- Emergency patches follow the same path at accelerated pace
- Rollback: re-deploy the previous image tag using `kubectl set image` or by reverting the GitOps-tracked manifest
