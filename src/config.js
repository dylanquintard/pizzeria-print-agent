const path = require("path");
const fs = require("fs");
require("dotenv").config();

function required(name) {
  const value = String(process.env[name] || "").trim();
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

function numberFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${name} must be a positive integer`);
  }
  return value;
}

const config = {
  apiBaseUrl: required("API_BASE_URL").replace(/\/+$/, ""),
  agentCode: required("AGENT_CODE"),
  agentToken: required("AGENT_TOKEN"),
  printerCode: required("PRINTER_CODE"),
  printerIp: required("PRINTER_IP"),
  printerPort: numberFromEnv("PRINTER_PORT", 9100),
  pollMs: numberFromEnv("POLL_MS", 3000),
  heartbeatMs: numberFromEnv("HEARTBEAT_MS", 10000),
  requestTimeoutMs: numberFromEnv("REQUEST_TIMEOUT_MS", 10000),
  socketTimeoutMs: numberFromEnv("SOCKET_TIMEOUT_MS", 5000),
  localHttpPort: numberFromEnv("LOCAL_HTTP_PORT", 3000),
  localAdminToken: String(process.env.LOCAL_ADMIN_TOKEN || "").trim(),
  sqlitePath: path.resolve(String(process.env.SQLITE_PATH || "./data/agent.db")),
  ticketHeader: String(process.env.TICKET_HEADER || "Pizzeria").trim(),
};

const sqliteDirectory = path.dirname(config.sqlitePath);
fs.mkdirSync(sqliteDirectory, { recursive: true });

module.exports = {
  config,
};
