import test from 'node:test';
import path from 'node:path';
import { createAuthRateLimit } from '../middleware/authRateLimit';
const { checkRateLimit } = require(path.resolve(process.cwd(), '../scripts/auth-rate-limit-contract.cjs'));
test('shared authentication budget: replicas, expiry, normalization and fail-closed', () => checkRateLimit(createAuthRateLimit));
