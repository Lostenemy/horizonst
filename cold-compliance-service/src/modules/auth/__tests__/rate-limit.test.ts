import test from 'node:test';
import path from 'node:path';
import { createAuthRateLimit } from '../../../middleware/auth-rate-limit';
const { checkRateLimit } = require(path.resolve(process.cwd(), '../scripts/auth-rate-limit-contract.cjs'));
test('Horneo shared authentication budget: replicas, expiry and isolated presence', () => checkRateLimit(createAuthRateLimit));
