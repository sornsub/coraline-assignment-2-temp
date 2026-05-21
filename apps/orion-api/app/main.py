import os
from fastapi import FastAPI

app = FastAPI(title="Orion API", version="1.0.0")


@app.get("/health")
def health():
    return {"status": "ok", "service": "orion-api"}


@app.get("/ready")
def ready():
    return {"status": "ready", "environment": os.getenv("APP_ENV", "local")}


@app.get("/api/v1/sources")
def sources():
    return {
        "sources": [
            {
                "name": "cloud-analytics-db",
                "type": "cloud-database",
                "connectivity": "private endpoint or VPC peering",
                "secretRef": "managed externally"
            },
            {
                "name": "on-prem-reporting-db",
                "type": "on-premise-database",
                "connectivity": "VPN or private interconnect",
                "secretRef": "managed externally"
            },
            {
                "name": "object-storage-lake",
                "type": "object-storage",
                "connectivity": "cloud IAM role or workload identity",
                "secretRef": "managed externally"
            }
        ]
    }
