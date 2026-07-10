import { readdir } from 'node:fs/promises';

const tests = (await readdir(new URL('../test/', import.meta.url)))
  .filter((file) => file.endsWith('.test.ts'))
  .sort();

for (const test of tests) await import(new URL(`../test/${test}`, import.meta.url));
