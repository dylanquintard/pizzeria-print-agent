const { config } = require("./config");
const { logger } = require("./logger");
const { createDb } = require("./db");
const { createBackendApi } = require("./backend-api");
const { createPrinterClient } = require("./printer");
const { createAgent } = require("./agent");
const { createHealthServer } = require("./health-server");

async function main() {
  logger.info(
    {
      apiBaseUrl: config.apiBaseUrl,
      agentCode: config.agentCode,
      printerCode: config.printerCode,
      printerIp: config.printerIp,
      printerPort: config.printerPort,
    },
    "starting print agent"
  );

  const db = createDb(config.sqlitePath);
  const api = createBackendApi(config);
  const printer = createPrinterClient(config);
  const agent = createAgent({ config, api, db, printer, logger });
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
