import assert from 'node:assert/strict';
import { hasBlockingActiveDistributorDocuments } from '../src/modules/admin/distributors.routes.js';

assert.equal(hasBlockingActiveDistributorDocuments({ blocking_documents: 0 }), false, 'approved-only active documents should not block approval');
assert.equal(hasBlockingActiveDistributorDocuments({ blocking_documents: 1 }), true, 'pending active documents should block approval');
assert.equal(hasBlockingActiveDistributorDocuments({ blocking_documents: '2' }), true, 'rejected active documents should block approval');
