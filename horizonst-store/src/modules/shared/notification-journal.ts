import { randomUUID } from 'node:crypto';
import { pool } from '../../db/pool.js';
import { lifecycle, type ServiceLifecycle } from '../../lifecycle.js';
import { env } from '../../config/env.js';
import type { NotificationOutcome } from './mail.js';

type Client = { query: (sql: string, params?: any[]) => Promise<{ rows: any[] }>; release: (destroy?: boolean) => void };
type Pool = { connect: () => Promise<Client> };
export type NotificationType = 'quote_available' | 'quote_accepted_commercial' | 'order_confirmation';
export type Intent = { historyId: string; type: NotificationType; orderId?: string };

// Called ONLY on the commercial transaction's connection, before COMMIT.
export async function insertNotificationIntent(client: Pick<Client, 'query'>, input: Intent): Promise<string> {
  const result = await client.query(`INSERT INTO store.notification_deliveries
    (status_history_id, notification_type, recipient_role, order_id)
    SELECT h.id, $2, $3, $4::uuid FROM store.quote_status_history h
    WHERE h.id=$1::uuid AND ($4::uuid IS NULL OR EXISTS
      (SELECT 1 FROM store.orders o WHERE o.id=$4::uuid AND o.quote_id=h.quote_id))
    RETURNING id`, [input.historyId, input.type, input.type === 'quote_accepted_commercial' ? 'commercial' : 'customer', input.orderId ?? null]);
  if (!result.rows[0]?.id) throw new Error('notification_intent_not_created');
  return result.rows[0].id;
}

// Local absolute bound, including pool wait. Never replay a write with an uncertain result.
export async function journalConnection<T>(db: Pool, work: (client: Client) => Promise<T>, budgetMs = 2000): Promise<T> {
  let client: Client | undefined, released = false, expired = false, timer: NodeJS.Timeout;
  const release = (destroy = false) => { if (client && !released) { released = true; client.release(destroy); } };
  const operation = Promise.resolve().then(() => db.connect()).then(async value => {
    client = value;
    if (expired) { release(true); throw new Error('notification_database_deadline'); }
    return work(value);
  });
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = setTimeout(() => { expired = true; release(true); reject(new Error('notification_database_deadline')); }, budgetMs);
    })]);
  } catch (error) { expired = true; throw error; }
  finally { clearTimeout(timer!); release(expired); }
}

export class NotificationJournal {
  private active = 0;
  constructor(private readonly db: Pool = pool, private readonly life: ServiceLifecycle = lifecycle,
    private readonly enabled = () => env.mail.enabled) {}

  start(): void {
    // Recovery only: pending is NEVER an automatic send queue.
    this.life.periodic('smtp-journal-recovery', 5000, () => this.recover(), true);
  }

  recover(): Promise<unknown> {
    return journalConnection(this.db, c => c.query(`WITH expired AS (
      SELECT id FROM store.notification_deliveries WHERE state='dispatching' AND lease_until<=clock_timestamp()
      ORDER BY lease_until LIMIT 100 FOR UPDATE SKIP LOCKED)
      UPDATE store.notification_deliveries d SET state='uncertain', result_code='lease_expired',
        finished_at=clock_timestamp() FROM expired e WHERE d.id=e.id AND d.state='dispatching'`));
  }

  dispatch(id: string, deliver: () => Promise<NotificationOutcome | void>): Promise<void> {
    // Bounded concurrency; overflow is durable pending for human review, not an in-memory queue.
    if (this.life.stopping || !this.enabled() || this.active >= 4) return Promise.resolve();
    this.active++;
    const work = (async () => {
      const attempt = randomUUID();
      const claim = await journalConnection(this.db, c => c.query(`WITH candidate AS (
        SELECT id FROM store.notification_deliveries WHERE id=$1::uuid AND state='pending' FOR UPDATE SKIP LOCKED)
        UPDATE store.notification_deliveries d SET state='dispatching', attempt_id=$2::uuid,
          started_at=clock_timestamp(), lease_until=clock_timestamp()+interval '25 seconds'
        FROM candidate c WHERE d.id=c.id AND d.state='pending' RETURNING d.id`, [id, attempt]));
      if (!claim.rows.length || this.life.stopping) return;
      // A failed/lost claim result never reaches SMTP. Unknown delivery proofs are uncertain.
      let result: NotificationOutcome;
      try { result = await deliver() || { state: 'uncertain', resultCode: 'transport_uncertain' }; }
      catch { result = { state: 'uncertain', resultCode: 'transport_uncertain' }; }
      await journalConnection(this.db, c => c.query(`UPDATE store.notification_deliveries
        SET state=$3, result_code=$4, smtp_code=$5, finished_at=clock_timestamp()
        WHERE id=$1::uuid AND attempt_id=$2::uuid AND state='dispatching' AND lease_until>clock_timestamp()`,
      [id, attempt, result.state, result.resultCode, result.smtpCode ?? null]));
    })().catch(() => {
      // No exception text, payload, recipient or config. A failed final write is recovered as uncertain.
      console.warn('notification_journal_review_required');
    }).finally(() => { this.active--; });
    return this.life.track(work);
  }
}

export const notificationJournal = new NotificationJournal();
