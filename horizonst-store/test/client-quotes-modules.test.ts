import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { quoteDecisionSchema } from '../src/modules/quotes/quotes.routes.js';

assert.deepEqual(quoteDecisionSchema.parse({}), {});
assert.deepEqual(quoteDecisionSchema.parse({ comment: '  Acepto la propuesta  ' }), { comment: 'Acepto la propuesta' });
assert.throws(() => quoteDecisionSchema.parse({ comment: 42 }));
assert.throws(() => quoteDecisionSchema.parse({ comment: 'x'.repeat(5001) }));
assert.throws(() => quoteDecisionSchema.parse({ comment: 'ok', unknown: true }));

const routes = readFileSync(new URL('../src/modules/quotes/quotes.routes.ts', import.meta.url), 'utf8');
assert.match(routes, /quotesRouter\.use\(requireAuth, requireRole\('customer', 'distributor'\)\)/, 'customer quote router must exclude admin role');
assert.match(routes, /WHERE q\.id = \$1 AND q\.user_id = \$2/, 'detail and PDF queries must be scoped by owner');
assert.match(routes, /WHERE q\.id = \$1 AND q\.user_id = \$2 FOR UPDATE/, 'decision query must lock and scope by owner');
assert.match(routes, /oldStatus !== 'sent'/, 'decision route must reject non-sent quotes with 409 before updates');
assert.match(routes, /quote_accepted/, 'accept decisions must create dedicated audit action');
assert.match(routes, /quote_rejected/, 'reject decisions must create dedicated audit action');
assert.doesNotMatch(routes, /internal_notes/, 'client quote routes must never expose internal notes');

const migration = readFileSync(new URL('../migrations/005_quote_client_decision_timestamps.sql', import.meta.url), 'utf8');
assert.match(migration, /ADD COLUMN IF NOT EXISTS accepted_at TIMESTAMPTZ/);
assert.match(migration, /ADD COLUMN IF NOT EXISTS rejected_at TIMESTAMPTZ/);
assert.doesNotMatch(migration, /ON DELETE CASCADE/i);
