# Coraline Challenge 2: Internal Web Application Platform

## Overview

This repository is a clean demo project for Coraline Challenge question 2. It designs a simple internal web application platform with a user portal, API service, workflow orchestration, an Apache HTTP service, a notebook-style service, Kubernetes deployment manifests, CI/CD, and operational guidance.

`app2.zip` was inspected only as an architecture reference. It contains Kubernetes examples for a multi-service platform with Deployments, Services, Ingresses, ConfigMaps, and PVCs. This project does not copy proprietary names, images, hosts, IPs, passwords, or secrets from that archive.

## Architecture Summary

The platform contains:

- `atlas-portal`: small Node/Express portal with `/health`, environment display, and service cards.
- `orion-api`: FastAPI service with `/health`, `/ready`, and `/api/v1/sources`.
- `airflow`: simplified demo manifest using the official Apache Airflow image.
- `apache-web`: simple Apache HTTP Server endpoint using the official `httpd` image.
- `notebook-lab`: lightweight notebook-style service for demonstration.
- `k8s/base` and `k8s/overlays`: Kustomize manifests for dev, staging, and prod.

Diagrams are in [docs/architecture.md](docs/architecture.md).

## Folder Structure

```text
.
├── apps/atlas-portal        # Node/Express portal
├── apps/orion-api           # FastAPI API
├── airflow/dags             # Sample DAG for reference/local demo
├── apache-web               # Local Apache index page
├── docs/architecture.md     # Mermaid architecture and pipeline diagrams
├── k8s/base                 # Shared Kubernetes resources
├── k8s/overlays             # dev/staging/prod Kustomize overlays
├── .github/workflows        # CI/CD workflow
├── .env.example             # Placeholder local environment values
└── docker-compose.yaml      # Local review stack
```

## Local Run

Copy `.env.example` if needed and start the local stack:

```powershell
docker compose up --build
```

Useful local URLs:

- Portal: `http://localhost:8080`
- API: `http://localhost:8000`
- API source catalog: `http://localhost:8000/api/v1/sources`
- Airflow demo: `http://localhost:8081`
- Apache web: `http://localhost:8082`
- Notebook: `http://localhost:8888`

The compose Airflow service uses `standalone` mode for local demonstration only.
The local Airflow password is a placeholder and can be overridden with `AIRFLOW_ADMIN_PASSWORD`.

## Kubernetes Deploy

Validate manifests:

```powershell
kubectl kustomize k8s/overlays/dev
kubectl kustomize k8s/overlays/staging
kubectl kustomize k8s/overlays/prod
```

Deploy manually if GitOps is not used:

```powershell
kubectl apply -k k8s/overlays/dev
kubectl apply -k k8s/overlays/staging
kubectl apply -k k8s/overlays/prod
```

Production Airflow should use the official Apache Airflow Helm chart, backed by production-grade metadata database, executor, DAG distribution, logging, and secret management. The included Airflow manifest is intentionally simplified for the assignment.

## CI/CD Pipeline

`.github/workflows/ci-cd.yaml` runs on pull requests and pushes to `dev`, `staging`, and `main`.

The pipeline:

- installs and tests `atlas-portal`
- installs and tests `orion-api`
- builds Docker images for the portal and API
- scans images with Trivy
- pushes images to GHCR on branch pushes
- validates all Kustomize overlays
- documents the deployment handoff

Branch mapping:

- `dev` branch -> dev environment
- `staging` branch -> staging environment
- `main` branch -> prod environment

Deployment is GitOps-preferred, using a controller such as Argo CD or Flux to watch the appropriate overlay. `kubectl apply -k` is the documented fallback.

## Environment Strategy

Dev, staging, and prod use separate Kustomize overlays. Each overlay changes namespace, resource sizing, replica count, image tag, ingress host placeholder, and non-sensitive config values.

Promotion should happen by pull request:

```text
dev -> staging -> main
```

Each promotion reuses the same manifest structure and changes only environment-specific overlay values and image tags.

## Configuration And Secrets

Non-sensitive values are stored in ConfigMaps, including environment name and internal service URLs. Placeholder secret examples are provided in `.env.example` and `k8s/base/secret-example.yaml`.

Do not commit real secrets. For production, use one of:

- External Secrets Operator with AWS Secrets Manager, Azure Key Vault, GCP Secret Manager, or Vault
- Sealed Secrets
- cloud-native workload identity instead of static credentials where possible

## External Connectivity

External systems should be reached through approved private connectivity:

- cloud databases through private endpoints, VPC peering, or service networking
- on-premise databases through VPN, Direct Connect, ExpressRoute, Interconnect, or equivalent
- object storage through IAM roles or workload identity

NetworkPolicies, firewall rules, DNS, TLS, and audit logging should be managed per environment.

## Production Operations

Health checks:

- `atlas-portal`: `/health`
- `orion-api`: `/health` and `/ready`
- Kubernetes readiness/liveness probes are included for the main services.

Monitoring and alerting:

- use Prometheus-compatible metrics where available
- visualize service health, latency, error rate, pod restarts, and resource use in Grafana
- alert on failed readiness, high error rate, workflow failures, and resource exhaustion

Logging:

- write application logs to stdout/stderr
- collect with the cluster logging stack, such as Fluent Bit plus OpenSearch, Loki, or a cloud logging service
- retain audit logs for external data access

## Assumptions And Limitations

- This is an assignment-ready demo, not a full production platform.
- Ingress hosts are safe placeholders under `example.internal`.
- Images use placeholder GHCR names in Kubernetes.
- Real registry names, cluster credentials, DNS, TLS certificates, and cloud secret backends must be supplied by the deploying organization.
- The notebook service is intentionally lightweight.
- The notebook service disables token auth for local review only; production must add authentication and network controls.
- Airflow production deployment should use the official Helm chart.
