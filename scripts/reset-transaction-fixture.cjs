// Doble transaccional, sin PostgreSQL ni red: modela bloqueo de usuario y rollback.
const assert = require('node:assert/strict');
exports.resetFixture = function (failAfterPassword = false) {
  let state = { consumed: false, password: 'before', sessions: 2, revoked: false };
  let queue = Promise.resolve();
  let released = 0;
  const statements = [];
  return {
    get state() { return state; },
    get released() { return released; },
    statements,
    pool: {
      async connect() {
        let transaction = false, local, unlock;
        const finish = () => { transaction = false; if (unlock) { unlock(); unlock = null; } };
        return {
          async query(sql) {
            statements.push(sql);
            if (sql === 'BEGIN') { transaction = true; return { rows: [] }; }
            assert.equal(transaction, true, 'all reset queries use a transaction on the same client');
            if (sql === 'ROLLBACK') { finish(); return { rows: [] }; }
            if (sql === 'COMMIT') { state = local; finish(); return { rows: [] }; }
            if (sql.startsWith('SELECT user_id FROM')) return { rows: state.consumed ? [] : [{ user_id: 'user-1' }] };
            if (sql.includes('FOR UPDATE')) {
              const previous = queue;
              queue = new Promise(resolve => { unlock = resolve; });
              await previous;
              local = { ...state };
              return { rows: [{ id: 'user-1' }], rowCount: 1 };
            }
            assert.ok(local, 'must lock user before mutations');
            if (sql.includes('RETURNING id')) {
              assert.match(sql, /used_at IS NULL AND expires_at > /);
              if (local.consumed) return { rows: [], rowCount: 0 };
              local.consumed = true;
              return { rows: [{ id: 'reset-1' }], rowCount: 1 };
            }
            if (sql.includes('SET password_hash')) { local.password = 'after'; return { rows: [], rowCount: 1 }; }
            if (failAfterPassword) throw new Error('injected transaction failure');
            if (sql.includes('auth_sessions') || sql.includes('refresh_tokens')) local.sessions = 0;
            else if (sql.includes('password_reset_tokens')) local.revoked = true;
            else throw new Error('Unexpected reset query');
            return { rows: [], rowCount: 1 };
          },
          release() { assert.equal(transaction, false); released++; }
        };
      }
    }
  };
};
