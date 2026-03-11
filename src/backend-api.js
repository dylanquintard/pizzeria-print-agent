const axios = require("axios");

function createBackendApi(config) {
  const client = axios.create({
    baseURL: config.apiBaseUrl,
    timeout: config.requestTimeoutMs,
    headers: {
      Authorization: `Bearer ${config.agentToken}`,
      "Content-Type": "application/json",
    },
  });

  return {
    async heartbeat(payload) {
      const response = await client.post(
        `/api/print/agents/${encodeURIComponent(config.agentCode)}/heartbeat`,
        payload
      );
      return response.data;
    },
    async claimNext(printerCode) {
      try {
        const response = await client.post(
          `/api/print/agents/${encodeURIComponent(config.agentCode)}/claim-next`,
          { printer_code: printerCode }
        );
        return response?.data?.job || null;
      } catch (err) {
        if (Number(err?.response?.status) === 204) {
          return null;
        }
        throw err;
      }
    },
    async markSuccess(jobId, payload) {
      const response = await client.post(
        `/api/print/agents/${encodeURIComponent(config.agentCode)}/jobs/${encodeURIComponent(jobId)}/success`,
        payload
      );
      return response.data;
    },
    async markFail(jobId, payload) {
      const response = await client.post(
        `/api/print/agents/${encodeURIComponent(config.agentCode)}/jobs/${encodeURIComponent(jobId)}/fail`,
        payload
      );
      return response.data;
    },
  };
}

module.exports = {
  createBackendApi,
};
