import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile, readdir } from 'node:fs/promises';
const require = createRequire(new URL('../web/package.json', import.meta.url));
const React = require('react') as typeof import('react');
const { renderToStaticMarkup } = require('react-dom/server') as typeof import('react-dom/server');
import { CommercialVisual, CommercialOperationDiagram } from '../web/src/components/CommercialVisual.js';

const directory = new URL('../web/public/images/comercial-v3/', import.meta.url);
const files = await readdir(directory);
assert.equal(files.length, 28);
assert.ok(files.every(file => /\.(?:avif|webp|svg)$/.test(file)), 'only selected web assets, no internal documents or originals');
for (const scene of ['hero', 'supervision', 'food', 'storage', 'preparation', 'installation'] as const) {
  const markup = renderToStaticMarkup(React.createElement(CommercialVisual, { scene }));
  assert.match(markup, /type="image\/avif"/);
  assert.match(markup, /type="image\/webp"/);
  assert.match(markup, /-movil\.avif/);
  assert.match(markup, /width="720" height="720"/);
  assert.match(markup, /width="1600" height="900"/);
  assert.match(markup, /loading="lazy"/);
  assert.match(markup, /object-fit:contain/);
  assert.match(markup, /generada con IA/);
  assert.doesNotMatch(markup, /C:\\|originales|prompts|Horneo|<script/i);
  for (const match of markup.matchAll(/(?:src|srcSet)="\/images\/comercial-v3\/([^"]+)"/g)) assert.ok(files.includes(match[1]));
}
const hero = renderToStaticMarkup(React.createElement(CommercialVisual, { scene: 'hero', priority: true }));
assert.match(hero, /loading="eager"/);
assert.match(hero, /fetchPriority="high"/);
const diagram = renderToStaticMarkup(React.createElement(CommercialOperationDiagram));
assert.match(diagram, /03-funcionamiento-movil\.svg/);
assert.match(diagram, /SOS al supervisor/);
const compact = renderToStaticMarkup(React.createElement(CommercialOperationDiagram, { compact: true }));
assert.match(compact, /03-funcionamiento-compacto-movil\.svg/);
assert.match(compact, /width="1600" height="480"/);
assert.match(compact, /width="720" height="1440"/);
for (const file of files.filter(file => file.endsWith('.svg'))) {
  const svg = await readFile(new URL(file, directory), 'utf8');
  assert.doesNotMatch(svg, /<script|foreignObject|(?:href|onload|onclick)\s*=|C:\\/i);
  assert.match(svg, /Esquema conceptual/);
  if (file.includes('compacto')) {
    assert.doesNotMatch(svg, /SOS|Alerta al supervisor/);
    for (const label of ['Trabajador con', 'Presencia, permanencia', 'Aviso al trabajador', 'Supervisor']) assert.ok(svg.includes(label));
  } else assert.match(svg, /SOS del trabajador/, 'original home diagram preserved');
}
console.log('Commercial visuals: six responsive scenes, bounded public assets and accessible diagram passed');
