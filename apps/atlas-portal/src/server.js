const express = require("express");

const app = express();
const port = process.env.PORT || 8080;

function parseLinks() {
  const fallback = [
    { name: "API Service", url: process.env.API_URL || "http://localhost:8000", description: "Orion API health and source catalog" },
    { name: "Apache Airflow", url: process.env.AIRFLOW_URL || "http://localhost:8081", description: "Workflow orchestration" },
    { name: "Notebook Service", url: process.env.NOTEBOOK_URL || "http://localhost:8888", description: "Notebook-style analytics workspace" },
    { name: "Apache HTTP Server", url: process.env.APACHE_WEB_URL || "http://localhost:8082", description: "Static internal web endpoint" },
    { name: "Monitoring/Grafana", url: process.env.GRAFANA_URL || "http://localhost:3000", description: "Dashboards and alert review" }
  ];

  if (!process.env.SERVICE_LINKS_JSON) {
    return fallback;
  }

  try {
    const parsed = JSON.parse(process.env.SERVICE_LINKS_JSON);
    return Array.isArray(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

app.get("/health", (_req, res) => {
  res.json({ status: "ok", service: "atlas-portal" });
});

app.get("/", (_req, res) => {
  const environment = process.env.APP_ENV || "local";
  const links = parseLinks();
  const cards = links.map((link) => `
    <a class="card" href="${link.url}">
      <span>${link.name}</span>
      <small>${link.description || link.url}</small>
    </a>
  `).join("");

  res.type("html").send(`<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Atlas Portal</title>
  <link rel="stylesheet" href="/styles.css">
</head>
<body>
  <main>
    <p class="eyebrow">Internal Application Platform</p>
    <h1>Atlas Portal</h1>
    <p class="env">Environment: <strong>${environment}</strong></p>
    <section class="grid">${cards}</section>
  </main>
</body>
</html>`);
});

app.use(express.static("public"));

app.listen(port, () => {
  console.log(`atlas-portal listening on ${port}`);
});
