const express = require("express");

function createHealthServer({ config, agent, logger }) {
  const app = express();
  app.use(express.json());

  function localAuthMiddleware(req, res, next) {
    if (!config.localAdminToken) {
      next();
      return;
    }

    const bearer = String(req.headers.authorization || "").trim();
    const headerToken = String(req.headers["x-local-token"] || "").trim();
    const token = bearer.startsWith("Bearer ") ? bearer.slice("Bearer ".length).trim() : headerToken;
    if (token !== config.localAdminToken) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    next();
  }

  app.get("/health", (_req, res) => {
    res.json(agent.getHealth());
  });

  app.post("/test-print", localAuthMiddleware, async (req, res) => {
    try {
      const text = String(req.body?.text || "Test print local");
      const printerCode = String(req.body?.printerCode || req.body?.printer_code || "").trim() || null;
      await agent.runTestPrint(text, printerCode);
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err: err?.message || err }, "test print failed");
      res.status(500).json({ error: err?.message || "Test print failed" });
    }
  });

  app.post("/reprint-last", localAuthMiddleware, async (req, res) => {
    try {
      const printerCode = String(req.body?.printerCode || req.body?.printer_code || "").trim() || null;
      await agent.reprintLastTicket(printerCode);
      res.json({ ok: true });
    } catch (err) {
      logger.error({ err: err?.message || err }, "reprint last failed");
      res.status(500).json({ error: err?.message || "Reprint failed" });
    }
  });

  const server = app.listen(config.localHttpPort, () => {
    logger.info({ port: config.localHttpPort }, "local health server started");
  });

  return {
    close() {
      server.close();
    },
  };
}

module.exports = {
  createHealthServer,
};
