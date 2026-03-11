function normalizeError(err) {
  const status = Number(err?.response?.status || 0);
  const code = err?.response?.data?.code || err?.code || "PRINT_AGENT_ERROR";
  const message = err?.response?.data?.error || err?.message || "Unknown error";
  return { status, code: String(code), message: String(message) };
}

function createAgent({ config, api, db, printer, logger }) {
  const state = {
    startedAt: new Date().toISOString(),
    lastHeartbeatAt: null,
    lastClaimAt: null,
    lastPrintAt: null,
    internetOk: true,
    printerOnline: false,
    workerRunning: false,
    heartbeatRunning: false,
    stopRequested: false,
    workerTimer: null,
    heartbeatTimer: null,
  };

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

  async function acknowledgeSuccess(jobId, claimToken) {
    const payload = {
      claim_token: claimToken,
      printed_at: new Date().toISOString(),
      meta: {
        source: "pi-agent",
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

  async function acknowledgeFailure(jobId, claimToken, errorCode, errorMessage) {
    const payload = {
      claim_token: claimToken,
      error_code: errorCode,
      error_message: errorMessage,
      retryable: true,
      meta: {
        source: "pi-agent",
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

  async function processClaimedJob(job) {
    const jobId = String(job?.id || "");
    const claimToken = String(job?.claim_token || "");
    if (!jobId || !claimToken) {
      throw new Error("Invalid claimed job payload");
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

      await printer.printOrder(job.payload);
      db.setState("last_job_id", jobId);
      db.setState("last_print_payload", JSON.stringify(job.payload || {}));
      state.lastPrintAt = new Date().toISOString();

      await acknowledgeSuccess(jobId, claimToken);
      logger.info({ jobId }, "job printed");
    } catch (err) {
      const normalized = normalizeError(err);
      db.upsertLocalJob({
        jobId,
        status: "FAILED_LOCAL",
        payload: job?.payload || null,
        lastError: `${normalized.code}: ${normalized.message}`,
      });
      await acknowledgeFailure(jobId, claimToken, normalized.code, normalized.message);
      logger.error({ jobId, err: normalized }, "job failed");
    }
  }

  async function workerTick() {
    if (state.workerRunning || state.stopRequested) return;
    state.workerRunning = true;
    try {
      await flushPendingAcks();
      const job = await api.claimNext(config.printerCode);
      if (!job) {
        state.internetOk = true;
        return;
      }
      state.lastClaimAt = new Date().toISOString();
      await processClaimedJob(job);
    } catch (err) {
      state.internetOk = false;
      logger.warn({ err: normalizeError(err) }, "worker tick failed");
    } finally {
      state.workerRunning = false;
    }
  }

  async function heartbeatTick() {
    if (state.heartbeatRunning || state.stopRequested) return;
    state.heartbeatRunning = true;
    try {
      const printerOnline = await printer.checkConnection();
      state.printerOnline = Boolean(printerOnline);

      await api.heartbeat({
        version: "1.0.0",
        internet_ok: state.internetOk,
        printers: [
          {
            code: config.printerCode,
            online: state.printerOnline,
            paper_ok: true,
          },
        ],
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
    async runTestPrint(text) {
      await printer.printTest(text || "Test print");
      state.lastPrintAt = new Date().toISOString();
      db.setState("last_test_print_at", state.lastPrintAt);
      return true;
    },
    async reprintLastTicket() {
      const raw = db.getState("last_print_payload");
      if (!raw) {
        throw new Error("No last printed payload in local spool");
      }
      const payload = JSON.parse(raw);
      await printer.printOrder(payload);
      state.lastPrintAt = new Date().toISOString();
      return true;
    },
    getHealth() {
      const lastJobId = db.getState("last_job_id");
      const pendingAckCount = db.getPendingAckCount();
      return {
        status: state.internetOk && state.printerOnline ? "ok" : "degraded",
        startedAt: state.startedAt,
        lastHeartbeatAt: state.lastHeartbeatAt,
        lastClaimAt: state.lastClaimAt,
        lastPrintAt: state.lastPrintAt,
        internetOk: state.internetOk,
        printerOnline: state.printerOnline,
        printer: {
          code: config.printerCode,
          ip: config.printerIp,
          port: config.printerPort,
        },
        spool: {
          pendingAcks: pendingAckCount,
          lastJobId: lastJobId || null,
        },
      };
    },
  };
}

module.exports = {
  createAgent,
};
