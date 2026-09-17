import { createRequire } from 'node:module';
import express from 'express';
import { configureTrustProxy, createTrustedProxy } from '../src/config/trust-proxy.js';

const { checkTrustedProxy } = createRequire(import.meta.url)('../../scripts/trusted-proxy-contract.cjs');
await checkTrustedProxy(express, configureTrustProxy, createTrustedProxy);
