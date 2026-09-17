import test from 'node:test';
import path from 'node:path';
import express from 'express';
import { configureTrustProxy, createTrustedProxy } from '../../../config/trust-proxy';

const { checkTrustedProxy } = require(path.resolve(process.cwd(), '../scripts/trusted-proxy-contract.cjs'));
test('Horneo trusts only the configured reverse proxy IP', () => checkTrustedProxy(express, configureTrustProxy, createTrustedProxy));
