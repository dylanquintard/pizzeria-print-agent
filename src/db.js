const Database = require("better-sqlite3");

function createDb(sqlitePath) {
  const db = new Database(sqlitePath);
  db.pragma("journal_mode = WAL");

  db.exec(`
    CREATE TABLE IF NOT EXISTS local_jobs (
      job_id TEXT PRIMARY KEY,
      status TEXT NOT NULL,
      payload TEXT,
      last_error TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS pending_acks (
      job_id TEXT PRIMARY KEY,
      ack_type TEXT NOT NULL,
      claim_token TEXT NOT NULL,
      payload TEXT NOT NULL,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    CREATE TABLE IF NOT EXISTS local_state (
      key TEXT PRIMARY KEY,
      value TEXT,
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);

  const upsertLocalJobStatement = db.prepare(`
    INSERT INTO local_jobs (job_id, status, payload, last_error, updated_at)
    VALUES (@jobId, @status, @payload, @lastError, datetime('now'))
    ON CONFLICT(job_id) DO UPDATE SET
      status = excluded.status,
      payload = excluded.payload,
      last_error = excluded.last_error,
      updated_at = datetime('now');
  `);

  const upsertPendingAckStatement = db.prepare(`
    INSERT INTO pending_acks (job_id, ack_type, claim_token, payload, attempt_count, updated_at)
    VALUES (@jobId, @ackType, @claimToken, @payload, 0, datetime('now'))
    ON CONFLICT(job_id) DO UPDATE SET
      ack_type = excluded.ack_type,
      claim_token = excluded.claim_token,
      payload = excluded.payload,
      updated_at = datetime('now');
  `);

  const incrementPendingAckStatement = db.prepare(`
    UPDATE pending_acks
    SET attempt_count = attempt_count + 1, updated_at = datetime('now')
    WHERE job_id = ?;
  `);

  const deletePendingAckStatement = db.prepare(`
    DELETE FROM pending_acks WHERE job_id = ?;
  `);

  const listPendingAcksStatement = db.prepare(`
    SELECT job_id as jobId, ack_type as ackType, claim_token as claimToken, payload, attempt_count as attemptCount
    FROM pending_acks
    ORDER BY updated_at ASC
    LIMIT ?;
  `);

  const upsertStateStatement = db.prepare(`
    INSERT INTO local_state (key, value, updated_at)
    VALUES (?, ?, datetime('now'))
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      updated_at = datetime('now');
  `);

  const getStateStatement = db.prepare(`
    SELECT value FROM local_state WHERE key = ? LIMIT 1;
  `);

  const countPendingAcksStatement = db.prepare(`
    SELECT COUNT(*) as count FROM pending_acks;
  `);

  return {
    close() {
      db.close();
    },
    upsertLocalJob({ jobId, status, payload = null, lastError = null }) {
      upsertLocalJobStatement.run({
        jobId: String(jobId),
        status: String(status),
        payload: payload ? JSON.stringify(payload) : null,
        lastError: lastError ? String(lastError) : null,
      });
    },
    savePendingAck({ jobId, ackType, claimToken, payload }) {
      upsertPendingAckStatement.run({
        jobId: String(jobId),
        ackType: String(ackType),
        claimToken: String(claimToken),
        payload: JSON.stringify(payload || {}),
      });
    },
    incrementPendingAck(jobId) {
      incrementPendingAckStatement.run(String(jobId));
    },
    deletePendingAck(jobId) {
      deletePendingAckStatement.run(String(jobId));
    },
    listPendingAcks(limit = 25) {
      return listPendingAcksStatement.all(Number(limit));
    },
    setState(key, value) {
      upsertStateStatement.run(String(key), value === undefined ? null : String(value));
    },
    getState(key) {
      const row = getStateStatement.get(String(key));
      return row ? row.value : null;
    },
    getPendingAckCount() {
      return Number(countPendingAcksStatement.get()?.count || 0);
    },
  };
}

module.exports = {
  createDb,
};
