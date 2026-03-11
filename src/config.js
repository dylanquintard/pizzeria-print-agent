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

function parsePrintersFromJson(rawValue) {
  const normalized = String(rawValue || "").trim();
  if (!normalized) return [];

  let parsed;
  try {
    parsed = JSON.parse(normalized);
  } catch (_err) {
    throw new Error("PRINTERS_JSON must be valid JSON");
  }

  if (!Array.isArray(parsed)) {
    throw new Error("PRINTERS_JSON must be an array");
  }

  const printers = parsed.map((entry, index) => {
    const code = String(entry?.code || "").trim();
    const ip = String(entry?.ip || "").trim();
    const port = Number(entry?.port || 9100);

    if (!code) throw new Error(`PRINTERS_JSON[${index}].code is required`);
    if (!ip) throw new Error(`PRINTERS_JSON[${index}].ip is required`);
    if (!Number.isInteger(port) || port <= 0) {
      throw new Error(`PRINTERS_JSON[${index}].port must be a positive integer`);
    }

    return {
      code,
      ip,
      port,
    };
  });

  const seenCodes = new Set();
  for (const printer of printers) {
    const key = String(printer.code || "").toLowerCase();
    if (seenCodes.has(key)) {
      throw new Error(`PRINTERS_JSON contains duplicate code: ${printer.code}`);
    }
    seenCodes.add(key);
  }

  return printers;
}

const printersFromJson = parsePrintersFromJson(process.env.PRINTERS_JSON);
const printers = printersFromJson.length > 0
  ? printersFromJson
  : [{
      code: required("PRINTER_CODE"),
      ip: required("PRINTER_IP"),
      port: numberFromEnv("PRINTER_PORT", 9100),
    }];

const config = {
  apiBaseUrl: required("API_BASE_URL").replace(/\/+$/, ""),
  agentCode: required("AGENT_CODE"),
  agentName: String(process.env.AGENT_NAME || process.env.AGENT_CODE || "Print Agent").trim(),
  agentToken: required("AGENT_TOKEN"),
  printers,
  printerCode: printers[0].code,
  printerIp: printers[0].ip,
  printerPort: printers[0].port,
  pollMs: numberFromEnv("POLL_MS", 3000),
  heartbeatMs: numberFromEnv("HEARTBEAT_MS", 10000),
  requestTimeoutMs: numberFromEnv("REQUEST_TIMEOUT_MS", 10000),
  socketTimeoutMs: numberFromEnv("SOCKET_TIMEOUT_MS", 5000),
  localHttpPort: numberFromEnv("LOCAL_HTTP_PORT", 3000),
  localAdminToken: String(process.env.LOCAL_ADMIN_TOKEN || "").trim(),
  sqlitePath: path.resolve(String(process.env.SQLITE_PATH || "./data/agent.db")),
};

const sqliteDirectory = path.dirname(config.sqlitePath);
fs.mkdirSync(sqliteDirectory, { recursive: true });

module.exports = {
  config,
};
