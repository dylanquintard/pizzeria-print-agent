const { config } = require("./config");
const { logger } = require("./logger");
const { createDb } = require("./db");
const { createBackendApi } = require("./backend-api");
const { createPrinterClient } = require("./printer");
const { createAgent } = require("./agent");
const { createHealthServer } = require("./health-server");

async function main() {
  const printers = config.printers.map((entry) => ({
    code: entry.code,
    ip: entry.ip,
    port: Number(entry.port),
  }));

  logger.info(
    {
      apiBaseUrl: config.apiBaseUrl,
      agentCode: config.agentCode,
      printers,
    },
    "starting print agent"
  );

  const db = createDb(config.sqlitePath);
  const api = createBackendApi(config);
  const printerClients = printers.map((printer) => ({
    ...printer,
    client: createPrinterClient({
      ...config,
      printerCode: printer.code,
      printerIp: printer.ip,
      printerPort: printer.port,
    }),
  }));
  const agent = createAgent({ config, api, db, printers: printerClients, logger });
  const healthServer = createHealthServer({ config, agent, logger });

  await agent.start();

  const shutdown = () => {
    logger.info("stopping print agent");
    agent.stop();
    healthServer.close();
    db.close();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error("fatal error:", err);
  process.exit(1);
});
