import { createRequire } from 'node:module';
import { createAuthRateLimit } from '../src/modules/auth/rate-limit.js';
const { checkRateLimit } = createRequire(import.meta.url)('../../scripts/auth-rate-limit-contract.cjs');
await checkRateLimit(createAuthRateLimit);
console.log('Store shared authentication rate limit: OK');
