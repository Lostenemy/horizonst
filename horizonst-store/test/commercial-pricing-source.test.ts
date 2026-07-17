import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';

const productionRoots = [new URL('../src/', import.meta.url), new URL('../web/src/', import.meta.url)];

const sourceFiles = async (directory: URL): Promise<URL[]> => {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map((entry) => {
    const url = new URL(entry.name + (entry.isDirectory() ? '/' : ''), directory);
    return entry.isDirectory() ? sourceFiles(url) : entry.name.endsWith('.ts') || entry.name.endsWith('.tsx') ? [url] : [];
  }));
  return nested.flat();
};

const files = (await Promise.all(productionRoots.map(sourceFiles))).flat();
const sources = await Promise.all(files.map(async (file) => ({ file: file.pathname, content: await readFile(file, 'utf-8') })));
const commercialPrices = /\b(?:60000|90000|120000|325000|650000|1299500)\b/;
const enterpriseCodeRule = /(?:code|offer_code)\s*={2,3}\s*['"]enterprise['"]/;

for (const source of sources) {
  assert.doesNotMatch(source.content, commercialPrices, `production pricing is not hardcoded in ${source.file}`);
  assert.doesNotMatch(source.content, enterpriseCodeRule, `Enterprise is not blocked by a code-specific rule in ${source.file}`);
}
