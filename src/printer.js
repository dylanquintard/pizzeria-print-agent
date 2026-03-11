const net = require("net");
const { buildOrderTicketBuffer, buildTestTicketBuffer } = require("./escpos");

function sendRawBuffer(host, port, buffer, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const socket = new net.Socket();
    let settled = false;

    const cleanup = () => {
      socket.removeAllListeners();
      socket.destroy();
    };

    socket.setTimeout(timeoutMs);

    socket.once("connect", () => {
      socket.write(buffer, (err) => {
        if (err) {
          if (!settled) {
            settled = true;
            cleanup();
            reject(err);
          }
          return;
        }
        socket.end();
      });
    });

    socket.once("timeout", () => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(new Error("Printer socket timeout"));
    });

    socket.once("error", (err) => {
      if (settled) return;
      settled = true;
      cleanup();
      reject(err);
    });

    socket.once("close", () => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(true);
    });

    socket.connect(port, host);
  });
}

async function checkPrinterTcp(host, port, timeoutMs = 3000) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let done = false;

    const finish = (result) => {
      if (done) return;
      done = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(result);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("timeout", () => finish(false));
    socket.once("error", () => finish(false));
    socket.connect(port, host);
  });
}

function createPrinterClient(options) {
  const host = String(options.printerIp || options.ip || "").trim();
  const port = Number(options.printerPort || options.port);
  const code = String(options.printerCode || options.code || "").trim();
  const timeoutMs = Number(options.socketTimeoutMs || 5000);
  const agentName = String(options.agentName || options.agentCode || "Print Agent");

  if (!host) {
    throw new Error(`Missing printer host for printer ${code || "(unknown)"}`);
  }
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(`Invalid printer port for printer ${code || "(unknown)"}`);
  }

  return {
    code,
    ip: host,
    port,
    async checkConnection() {
      return checkPrinterTcp(host, port, Math.min(timeoutMs, 3000));
    },
    async printOrder(payload) {
      const buffer = buildOrderTicketBuffer(payload, { agentName });
      await sendRawBuffer(host, port, buffer, timeoutMs);
      return true;
    },
    async printTest(text) {
      const buffer = buildTestTicketBuffer(text, { agentName });
      await sendRawBuffer(host, port, buffer, timeoutMs);
      return true;
    },
  };
}

module.exports = {
  createPrinterClient,
};
