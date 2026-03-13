import { db } from '../../../db/pool';

export async function findRecentByDedupKey(dedupKey: string, windowMs: number) {
  const result = await db.query(
    `SELECT * FROM tag_commands
     WHERE dedup_key = $1 AND created_at > NOW() - ($2 || ' milliseconds')::interval
     ORDER BY created_at DESC LIMIT 1`,
    [dedupKey, windowMs]
  );
  return result.rows[0] ?? null;
}

export async function createTagCommand(input: {
  workerId?: string;
  tagId: string;
  gatewayId: string;
  commandType: string;
  templateCode?: string;
  triggerSource: string;
  triggerReason: string;
  msgId: number;
  topic: string;
  payload: Record<string, unknown>;
  timeoutMs: number;
  dedupKey?: string;
}) {
  const result = await db.query(
    `INSERT INTO tag_commands(worker_id, tag_id, gateway_id, command_type, template_code, trigger_source, trigger_reason, msg_id, topic, payload_json, timeout_ms, dedup_key)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     RETURNING *`,
    [
      input.workerId ?? null,
      input.tagId,
      input.gatewayId,
      input.commandType,
      input.templateCode ?? null,
      input.triggerSource,
      input.triggerReason,
      input.msgId,
      input.topic,
      input.payload,
      input.timeoutMs,
      input.dedupKey ?? null
    ]
  );
  return result.rows[0];
}

export async function createAttempt(tagCommandId: string, attemptNo: number, topic: string, payload: Record<string, unknown>) {
  const result = await db.query(
    `INSERT INTO tag_command_attempts(tag_command_id, attempt_no, topic, payload_json)
     VALUES($1,$2,$3,$4) RETURNING *`,
    [tagCommandId, attemptNo, topic, payload]
  );
  return result.rows[0];
}

export async function markAttemptResult(attemptId: string, status: string, error?: string) {
  await db.query(
    `UPDATE tag_command_attempts
     SET status = $2, error_message = $3, finished_at = NOW()
     WHERE id = $1`,
    [attemptId, status, error ?? null]
  );
}

export async function updateCommandStatus(commandId: string, status: string, patch?: { sent?: boolean; completed?: boolean; retriesCount?: number; lastError?: string }) {
  await db.query(
    `UPDATE tag_commands
     SET status = $2,
         retries_count = COALESCE($3, retries_count),
         sent_at = CASE WHEN $4 THEN COALESCE(sent_at, NOW()) ELSE sent_at END,
         completed_at = CASE WHEN $5 THEN NOW() ELSE completed_at END,
         last_error = COALESCE($6, last_error)
     WHERE id = $1`,
    [commandId, status, patch?.retriesCount ?? null, patch?.sent ?? false, patch?.completed ?? false, patch?.lastError ?? null]
  );
}

export async function appendResponse(input: {
  tagCommandId: string;
  gatewayMac: string;
  msgId: number;
  resultCode?: number;
  resultMsg?: string;
  payload: Record<string, unknown>;
}) {
  await db.query(
    `INSERT INTO tag_command_responses(tag_command_id, gateway_mac, msg_id, result_code, result_msg, response_payload_json)
     VALUES($1,$2,$3,$4,$5,$6)`,
    [input.tagCommandId, input.gatewayMac, input.msgId, input.resultCode ?? null, input.resultMsg ?? null, input.payload]
  );
}

export async function findOpenCommandByGatewayAndMsgId(gatewayMac: string, msgId: number) {
  const result = await db.query(
    `SELECT tc.* FROM tag_commands tc
     JOIN gateways g ON g.id = tc.gateway_id
     WHERE g.gateway_mac = $1 AND tc.msg_id = $2 AND tc.status IN ('pending','sent')
     ORDER BY tc.created_at DESC LIMIT 1`,
    [gatewayMac.toLowerCase(), msgId]
  );
  return result.rows[0] ?? null;
}

export async function listCommands() {
  return (await db.query('SELECT * FROM tag_commands ORDER BY created_at DESC LIMIT 300')).rows;
}

export async function getCommand(id: string) {
  const command = (await db.query('SELECT * FROM tag_commands WHERE id = $1', [id])).rows[0] ?? null;
  if (!command) return null;
  const attempts = (await db.query('SELECT * FROM tag_command_attempts WHERE tag_command_id = $1 ORDER BY attempt_no ASC', [id])).rows;
  const responses = (await db.query('SELECT * FROM tag_command_responses WHERE tag_command_id = $1 ORDER BY received_at DESC', [id])).rows;
  return { ...command, attempts, responses };
}

export async function listActiveCommands() {
  return (await db.query("SELECT * FROM tag_commands WHERE status IN ('pending','sent') ORDER BY created_at DESC")).rows;
}
