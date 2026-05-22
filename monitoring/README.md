# Monitoring and Observability

> **Assignment note:** This directory contains design evidence for the observability layer of the atlas-platform.
> The files here describe how monitoring, alerting, and logging are designed to work — they are **not deployed
> as part of this repository**. No live Prometheus, Grafana, or Alertmanager instance is required to review
> this material. See the constraints section at the bottom for what is and is not in scope.

---

## Observability Design Overview

The platform is designed around three observability pillars:

| Pillar | Tool | Purpose |
|---|---|---|
| Metrics | Prometheus + Grafana | Collect numeric time-series data; visualise service health and resource use |
| Alerting | Alertmanager | Route firing alerts to the right team via Slack or PagerDuty |
| Logging | Fluent Bit + OpenSearch / Loki | Collect structured logs from all pods; support search and retention |

All five platform services (`atlas-portal`, `orion-api`, `airflow`, `apache-web`, `notebook-lab`) are observable through this design. Each service exposes a health endpoint; the API and portal can additionally expose a `/metrics` endpoint for Prometheus scraping.

---

## Metrics Collection — Prometheus

### How Prometheus scrapes the platform

Prometheus uses the **Prometheus Operator** pattern for Kubernetes-native configuration:

1. A `Prometheus` custom resource is deployed in the cluster (e.g., via the `kube-prometheus-stack` Helm chart)
2. Each service that exposes `/metrics` is discovered via a `ServiceMonitor` custom resource or pod annotation
3. Prometheus scrapes metrics at a configured interval (default: 15s)
4. Metrics are stored in Prometheus's time-series database and available for querying with PromQL

### What metrics each service should expose

| Service | Instrumentation library | Key metrics |
|---|---|---|
| `atlas-portal` (Node.js) | `prom-client` | HTTP request count, latency, process memory, event loop lag |
| `orion-api` (FastAPI) | `prometheus-fastapi-instrumentator` | HTTP request count by status, latency histogram, active requests |
| `airflow` | StatsD exporter sidecar or `airflow-exporter` | DAG run count, task state (success / failed / running), scheduler heartbeat |
| `apache-web` | Apache `mod_status` with exporter | Request rate, bytes served, worker states |
| `notebook-lab` | JupyterLab metrics plugin (optional) | Kernel count, CPU/memory per kernel |

Kubernetes platform metrics (pod status, resource consumption) are collected automatically by:
- **kube-state-metrics** — pod readiness, deployment status, container resource limits
- **cAdvisor** (built into kubelet) — container CPU, memory, filesystem usage

### Prometheus configuration (example)

A `ServiceMonitor` for `orion-api` would look like:

```yaml
# Example only — not applied in this repository
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: orion-api-metrics
  namespace: atlas-prod
spec:
  selector:
    matchLabels:
      app: orion-api
  endpoints:
    - port: http
      path: /metrics
      interval: 15s
```

---

## Alert Rules — Prometheus

Alert rules are defined in `monitoring/prometheus-rules.yaml` using the `PrometheusRule` CRD format.

### Defined alerts

| Alert name | Condition | Severity | For |
|---|---|---|---|
| `ServiceTargetDown` | Prometheus cannot scrape `atlas-portal`, `orion-api`, or `airflow` | critical | 2m |
| `KubernetesPodNotReady` | Any pod in `atlas-*` namespace fails readiness for > 2 min | critical | 2m |
| `HighHttp5xxRate` | HTTP 5xx responses exceed 5% of total requests over 5 min | warning | 5m |
| `HighContainerMemoryUsage` | Container memory exceeds 90% of its configured limit for > 10 min | warning | 10m |
| `AirflowDagFailure` | One or more DAG runs fail within a 5-minute window | warning | 0m (immediate) |

### Applying the rules to a cluster

```bash
# Apply to the target environment namespace
kubectl apply -f monitoring/prometheus-rules.yaml -n atlas-prod

# Validate structure without a cluster
kubectl apply --dry-run=client -f monitoring/prometheus-rules.yaml
```

The `PrometheusRule` resource is picked up automatically by the Prometheus Operator when the `prometheus` and `role` labels match the operator's `ruleSelector` configuration.

---

## Dashboarding — Grafana

### Design intent

Grafana connects to Prometheus as a data source and displays dashboards for each service and for the platform as a whole.

### Recommended dashboards

| Dashboard | Panels |
|---|---|
| Platform Overview | Pod status for all services, request rate, error rate, Airflow DAG success / failure trend |
| atlas-portal | HTTP request rate, p50 / p95 / p99 latency, error rate, pod restarts |
| orion-api | Same as portal + data source call latency and error count |
| Airflow | DAG run duration, task success / failure / retry counts, scheduler heartbeat lag |
| Kubernetes Resources | CPU and memory usage vs limits, per pod and per namespace |

### Grafana URL

The `GRAFANA_URL` placeholder in the platform ConfigMap (`k8s/base/configmap.yaml`) is linked from the portal's service card:

```yaml
GRAFANA_URL: https://grafana.example.internal
```

Replace this with the real Grafana hostname when deploying to a live environment.

### Provisioning dashboards as code

Grafana dashboards can be version-controlled as JSON and provisioned automatically using Grafana's dashboard provisioning mechanism or the `grafana-operator`. This keeps dashboard definitions in Git alongside the rest of the platform configuration.

---

## Alert Routing — Alertmanager

### Design intent

Alertmanager receives firing alerts from Prometheus and routes them to notification channels based on severity and team labels.

### Routing design

```
Prometheus (alert fires)
    │
    └─► Alertmanager
            │
            ├─ severity=critical  →  PagerDuty  (immediate on-call page)
            └─ severity=warning   →  Slack      (#platform-alerts channel)
```

### Example routing configuration (design only — no real values)

```yaml
# Example Alertmanager config structure — do NOT use real webhook URLs
# In production, store this config as a Kubernetes Secret managed by
# External Secrets Operator or Sealed Secrets.

route:
  group_by: [alertname, namespace]
  group_wait: 30s
  group_interval: 5m
  repeat_interval: 4h
  receiver: slack-default
  routes:
    - match:
        severity: critical
      receiver: pagerduty-platform
    - match:
        severity: warning
      receiver: slack-platform

receivers:
  - name: slack-default
    slack_configs:
      - api_url: "<SLACK_WEBHOOK_URL_FROM_SECRET>"    # managed externally
        channel: "#platform-alerts"
        title: "{{ .GroupLabels.alertname }}"
        text: "{{ range .Alerts }}{{ .Annotations.description }}{{ end }}"

  - name: slack-platform
    slack_configs:
      - api_url: "<SLACK_WEBHOOK_URL_FROM_SECRET>"    # managed externally
        channel: "#platform-alerts"

  - name: pagerduty-platform
    pagerduty_configs:
      - service_key: "<PAGERDUTY_SERVICE_KEY_FROM_SECRET>"   # managed externally
        description: "{{ .GroupLabels.alertname }}: {{ .CommonAnnotations.summary }}"
```

**Secret management:** All webhook URLs and API keys must be stored in a Kubernetes Secret (managed by External Secrets Operator, Sealed Secrets, or equivalent) and referenced by Alertmanager's config secret. Never commit real values to this repository.

---

## Logging Approach

### Design intent

All platform services write structured logs to **stdout / stderr**. The cluster logging stack collects, indexes, and retains those logs.

### Log flow

```
Pod (stdout / stderr)
    │
    └─► Fluent Bit (DaemonSet)
            │
            ├─► OpenSearch / Elasticsearch  →  Kibana (log search and dashboards)
            └─► Loki (alternative)          →  Grafana (log exploration via LogQL)
```

### Application logging guidelines

| Guideline | Rationale |
|---|---|
| Write to stdout / stderr only | Kubernetes logging infrastructure reads pod log streams; no log files to manage |
| Use structured JSON format | Machine-readable; enables log filtering by field (e.g., `level`, `request_id`, `status`) |
| Include a request ID header | Correlate logs across portal → API → external system calls |
| Set log level via environment variable | `LOG_LEVEL` from the platform ConfigMap; change without rebuilding the image |
| Retain audit logs separately | External data access events should be retained independently for compliance |

### Log retention

| Environment | Retention (design) |
|---|---|
| dev | 7 days |
| staging | 14 days |
| prod | 90 days (or per organisational policy) |
| Audit logs (prod) | 1 year or per compliance requirement |

---

## How This Fits the Assignment

The assignment asks for:

> *Operational readiness: monitoring, logging, health checks, alerting, stability*

This directory addresses that requirement as follows:

| Requirement | Evidence |
|---|---|
| Health checks | Kubernetes `readinessProbe` and `livenessProbe` in `k8s/base/<service>/deployment.yaml`; health endpoints at `/health` and `/ready` in `atlas-portal` and `orion-api` |
| Monitoring | `prometheus-rules.yaml` — PrometheusRule CRD with 5 alert definitions; ServiceMonitor pattern described above |
| Alerting | Alertmanager routing design with severity-based routing to Slack and PagerDuty |
| Logging | stdout / stderr pattern, Fluent Bit + OpenSearch / Loki design, structured JSON logging guidelines |
| Stability | Multi-replica prod deployment (3 replicas for portal and API), resource limits on all services, readiness gates before traffic is routed |

---

## Scope and Constraints

| Item | Status |
|---|---|
| `prometheus-rules.yaml` | Design evidence — valid CRD YAML, not applied to a live cluster in this repo |
| Prometheus runtime | Not deployed — requires Prometheus Operator (e.g., `kube-prometheus-stack` Helm chart) |
| Grafana runtime | Not deployed — `GRAFANA_URL` is a placeholder in the platform ConfigMap |
| Alertmanager config | Not deployed — no real webhook URLs or API keys in this repository |
| Fluent Bit / log stack | Not deployed — log collection approach documented here as design intent |
| Applying rules | `kubectl apply --dry-run=client -f monitoring/prometheus-rules.yaml` validates structure |
