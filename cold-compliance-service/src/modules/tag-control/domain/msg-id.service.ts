import { db } from '../../../db/pool';
import { env } from '../../../config/env';

let current = env.TAG_CONTROL_MSG_ID_START;

export async function nextMsgId(): Promise<number> {
  const result = await db.query(
    `SELECT COALESCE(MAX(msg_id), $1) AS max_id FROM tag_commands WHERE created_at > NOW() - INTERVAL '7 days'`,
    [env.TAG_CONTROL_MSG_ID_START]
  );
  const fromDb = Number(result.rows[0]?.max_id ?? env.TAG_CONTROL_MSG_ID_START);
  current = Math.max(current, fromDb) + 1;
  return current;
}
