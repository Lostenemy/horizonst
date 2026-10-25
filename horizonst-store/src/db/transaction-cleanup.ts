type Client = { query: (sql: string) => Promise<unknown> };

// Cleanup only. Does not retry transactions/writes or infer a COMMIT outcome.
// The caller still owns the original error and releases the client in its single finally.
export function transactionCleanup(client: Client) {
  let commitAttempted = false, rollbackAttempted = false, discard = false;
  const rollback = async () => {
    rollbackAttempted = true;
    try { await client.query('ROLLBACK'); }
    catch (error) { discard = true; throw error; }
  };
  return {
    get discard() { return discard; },
    rollback,
    async commit() { commitAttempted = true; await client.query('COMMIT'); },
    async failed(error: unknown) {
      const code = String((error as any)?.code ?? '');
      const severity = (error as any)?.severity;
      discard ||= commitAttempted || code.startsWith('08') || /^57P0[123]$/.test(code)
        || ['ECONNRESET','EPIPE','ETIMEDOUT','ECONNREFUSED'].includes(code)
        || severity === 'FATAL' || severity === 'PANIC';
      // A lost COMMIT reply is uncertain; ROLLBACK cannot prove it was not committed.
      // A failed explicit rollback is not attempted a second time either.
      if (!commitAttempted && !rollbackAttempted) {
        try { await rollback(); } catch { /* Secondary failure must not replace the original. */ }
      }
    }
  };
}
