function normalizeError(err) {
  const status = Number(err?.response?.status || 0);
  const code = err?.response?.data?.code || err?.code || "PRINT_AGENT_ERROR";
  const message = err?.response?.data?.error || err?.message || "Unknown error";
  return { status, code: String(code), message: String(message) };
}

function normalizeCode(value) {
  return String(value || "").trim().toLowerCase();
}

function createAgent({ config, api, db, printers, logger }) {
  const printerEntries = Array.isArray(printers) ? printers : [];
  if (printerEntries.length === 0) {
    throw new Error("No printer configured for print agent");
  }

  const printerByCode = new Map();
  for (const entry of printerEntries) {
    const code = normalizeCode(entry?.code);
    if (!code || !entry?.client) {
      throw new Error("Invalid printer entry: missing code/client");
    }
    if (printerByCode.has(code)) {
      throw new Error(`Duplicate printer code in agent config: ${code}`);
    }
    printerByCode.set(code, {
      code,
      ip: String(entry?.ip || entry?.client?.ip || "").trim(),
      port: Number(entry?.port || entry?.client?.port || 9100),
      client: entry.client,
    });
  }

  const orderedPrinters = [...printerByCode.values()];

  const state = {
    startedAt: new Date().toISOString(),
    lastHeartbeatAt: null,
    lastClaimAt: null,
    lastPrintAt: null,
    internetOk: true,
    printerOnline: false,
    printerOnlineByCode: Object.fromEntries(orderedPrinters.map((entry) => [entry.code, false])),
    workerRunning: false,
    heartbeatRunning: false,
    stopRequested: false,
    workerTimer: null,
    heartbeatTimer: null,
  };

  function pickPrinterByCode(code) {
    const normalized = normalizeCode(code);
    if (normalized && printerByCode.has(normalized)) {
      return printerByCode.get(normalized);
    }
    return orderedPrinters[0] || null;
  }

  function rememberPrintedPayload(printerCode, jobId, payload) {
    const serializedPayload = JSON.stringify(payload || {});
    db.setState("last_job_id", jobId);
    db.setState("last_print_payload", serializedPayload);
    if (printerCode) {
      db.setState(`last_job_id:${printerCode}`, jobId);
      db.setState(`last_print_payload:${printerCode}`, serializedPayload);
    }
  }

  async function flushPendingAcks() {
    const pending = db.listPendingAcks(25);
    if (pending.length === 0) return;

    for (const entry of pending) {
      try {
        const payload = JSON.parse(entry.payload || "{}");
        if (entry.ackType === "success") {
          await api.markSuccess(entry.jobId, payload);
        } else {
          await api.markFail(entry.jobId, payload);
        }
        db.deletePendingAck(entry.jobId);
        logger.info({ jobId: entry.jobId, ackType: entry.ackType }, "pending ack flushed");
      } catch (err) {
        const normalized = normalizeError(err);
        db.incrementPendingAck(entry.jobId);
        logger.warn({ jobId: entry.jobId, err: normalized }, "failed flushing pending ack");
        state.internetOk = false;
        break;
      }
    }
  }

  async function acknowledgeSuccess(jobId, claimToken, printerCode) {
    const payload = {
      claim_token: claimToken,
      printed_at: new Date().toISOString(),
      meta: {
        source: "pi-agent",
        printer_code: printerCode || null,
      },
    };

    try {
      await api.markSuccess(jobId, payload);
      db.upsertLocalJob({ jobId, status: "PRINTED" });
      state.internetOk = true;
    } catch (err) {
      db.savePendingAck({
        jobId,
        ackType: "success",
        claimToken,
        payload,
      });
      logger.warn({ jobId, err: normalizeError(err) }, "unable to send success ack, queued locally");
      state.internetOk = false;
    }
  }

  async function acknowledgeFailure(jobId, claimToken, errorCode, errorMessage, printerCode) {
    const payload = {
      claim_token: claimToken,
      error_code: errorCode,
      error_message: errorMessage,
      retryable: true,
      meta: {
        source: "pi-agent",
        printer_code: printerCode || null,
      },
    };

    try {
      await api.markFail(jobId, payload);
      state.internetOk = true;
    } catch (err) {
      db.savePendingAck({
        jobId,
        ackType: "fail",
        claimToken,
        payload,
      });
      logger.warn({ jobId, err: normalizeError(err) }, "unable to send failure ack, queued locally");
      state.internetOk = false;
    }
  }

  async function processClaimedJob(job, requestedPrinterCode) {
    const jobId = String(job?.id || "");
    const claimToken = String(job?.claim_token || "");
    if (!jobId || !claimToken) {
      throw new Error("Invalid claimed job payload");
    }

    const payloadPrinterCode = normalizeCode(job?.payload?.printer_code || requestedPrinterCode);
    const printer = pickPrinterByCode(payloadPrinterCode);
    if (!printer) {
      throw new Error(`No local printer client configured for code: ${payloadPrinterCode || "(unknown)"}`);
    }

    db.upsertLocalJob({
      jobId,
      status: "CLAIMED",
      payload: job?.payload || null,
    });

    try {
      if (job?.payload?.type !== "order_ticket") {
        throw new Error(`Unsupported ticket type: ${String(job?.payload?.type || "unknown")}`);
      }

      await printer.client.printOrder(job.payload);
      rememberPrintedPayload(printer.code, jobId, job.payload);
      state.lastPrintAt = new Date().toISOString();

      await acknowledgeSuccess(jobId, claimToken, printer.code);
      logger.info({ jobId, printerCode: printer.code }, "job printed");
    } catch (err) {
      const normalized = normalizeError(err);
      db.upsertLocalJob({
        jobId,
        status: "FAILED_LOCAL",
        payload: job?.payload || null,
        lastError: `${normalized.code}: ${normalized.message}`,
      });
      await acknowledgeFailure(jobId, claimToken, normalized.code, normalized.message, printer.code);
      logger.error({ jobId, printerCode: printer.code, err: normalized }, "job failed");
    }
  }

  async function workerTick() {
    if (state.workerRunning || state.stopRequested) return;
    state.workerRunning = true;
    let hadNetworkError = false;

    try {
      await flushPendingAcks();

      for (const printer of orderedPrinters) {
        try {
          const job = await api.claimNext(printer.code);
          if (!job) continue;

          state.lastClaimAt = new Date().toISOString();
          await processClaimedJob(job, printer.code);
        } catch (err) {
          hadNetworkError = true;
          logger.warn({ printerCode: printer.code, err: normalizeError(err) }, "claim/process tick failed");
        }
      }
    } catch (err) {
      hadNetworkError = true;
      logger.warn({ err: normalizeError(err) }, "worker tick failed");
    } finally {
      state.internetOk = !hadNetworkError;
      state.workerRunning = false;
    }
  }

  async function heartbeatTick() {
    if (state.heartbeatRunning || state.stopRequested) return;
    state.heartbeatRunning = true;
    try {
      const printersHeartbeat = [];

      for (const printer of orderedPrinters) {
        let online = false;
        try {
          // eslint-disable-next-line no-await-in-loop
          online = await printer.client.checkConnection();
        } catch (_err) {
          online = false;
        }
        state.printerOnlineByCode[printer.code] = Boolean(online);
        printersHeartbeat.push({
          code: printer.code,
          online: Boolean(online),
          paper_ok: true,
        });
      }

      state.printerOnline = printersHeartbeat.every((entry) => entry.online !== false);

      await api.heartbeat({
        version: "1.0.0",
        internet_ok: state.internetOk,
        printers: printersHeartbeat,
      });

      state.lastHeartbeatAt = new Date().toISOString();
      state.internetOk = true;
    } catch (err) {
      state.internetOk = false;
      logger.warn({ err: normalizeError(err) }, "heartbeat failed");
    } finally {
      state.heartbeatRunning = false;
    }
  }

  return {
    async start() {
      state.stopRequested = false;
      await heartbeatTick();
      await workerTick();

      state.workerTimer = setInterval(workerTick, config.pollMs);
      state.heartbeatTimer = setInterval(heartbeatTick, config.heartbeatMs);

      if (typeof state.workerTimer.unref === "function") state.workerTimer.unref();
      if (typeof state.heartbeatTimer.unref === "function") state.heartbeatTimer.unref();
    },
    stop() {
      state.stopRequested = true;
      if (state.workerTimer) clearInterval(state.workerTimer);
      if (state.heartbeatTimer) clearInterval(state.heartbeatTimer);
      state.workerTimer = null;
      state.heartbeatTimer = null;
    },
    async runTestPrint(text, printerCode = null) {
      const printer = pickPrinterByCode(printerCode);
      if (!printer) throw new Error("No printer configured");
      await printer.client.printTest(text || "Test print");
      state.lastPrintAt = new Date().toISOString();
      db.setState("last_test_print_at", state.lastPrintAt);
      return true;
    },
    async reprintLastTicket(printerCode = null) {
      let raw = null;
      const normalizedCode = normalizeCode(printerCode);
      if (normalizedCode) {
        raw = db.getState(`last_print_payload:${normalizedCode}`);
      }
      if (!raw) {
        raw = db.getState("last_print_payload");
      }
      if (!raw) {
        throw new Error("No last printed payload in local spool");
      }

      const payload = JSON.parse(raw);
      const payloadCode = normalizeCode(payload?.printer_code || payload?.printer?.code || null);
      const printer = pickPrinterByCode(normalizedCode || payloadCode);
      if (!printer) throw new Error("No printer configured for reprint");

      await printer.client.printOrder(payload);
      state.lastPrintAt = new Date().toISOString();
      return true;
    },
    getHealth() {
      const pendingAckCount = db.getPendingAckCount();
      const printersHealth = orderedPrinters.map((entry) => ({
        code: entry.code,
        ip: entry.ip,
        port: entry.port,
        online: Boolean(state.printerOnlineByCode[entry.code]),
        lastJobId: db.getState(`last_job_id:${entry.code}`) || null,
      }));
      const firstPrinter = printersHealth[0] || null;

      return {
        status: state.internetOk && state.printerOnline ? "ok" : "degraded",
        startedAt: state.startedAt,
        lastHeartbeatAt: state.lastHeartbeatAt,
        lastClaimAt: state.lastClaimAt,
        lastPrintAt: state.lastPrintAt,
        internetOk: state.internetOk,
        printerOnline: state.printerOnline,
        printer: firstPrinter
          ? {
              code: firstPrinter.code,
              ip: firstPrinter.ip,
              port: firstPrinter.port,
            }
          : null,
        printers: printersHealth,
        spool: {
          pendingAcks: pendingAckCount,
          lastJobId: db.getState("last_job_id") || null,
        },
      };
    },
  };
}

module.exports = {
  createAgent,
};
