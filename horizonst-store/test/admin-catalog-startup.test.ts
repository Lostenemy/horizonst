import assert from 'node:assert/strict';
import { adminCatalogRouter } from '../src/modules/admin/catalog.routes.js';

assert.ok(adminCatalogRouter, 'admin catalog router must import without runtime schema errors');
