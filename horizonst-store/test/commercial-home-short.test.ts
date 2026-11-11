import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { CommercialHome, CommercialInfo, CommercialSection } from '../web/src/pages/CommercialContent.js';
import { HorneoCase } from '../web/src/components/PublicMarketingShell.js';
import { commercialCopy } from '../web/src/lib/commercial-copy.js';
const require = createRequire(new URL('../web/package.json', import.meta.url));
const React = require('react') as typeof import('react');
const { renderToStaticMarkup } = require('react-dom/server') as typeof import('react-dom/server');
const home = renderToStaticMarkup(React.createElement(CommercialHome));
const info = renderToStaticMarkup(React.createElement(CommercialInfo));
const source = commercialCopy['/'];
for (const sectionIndex of [0, 1, 2, 4]) {
  assert.ok(!home.includes(source.sections[sectionIndex]!.title), 'extensive detail must not return to home');
}
assert.equal((info.match(/<h2 id="info-process-title">Funcionamiento en cuatro pasos<\/h2>/g) ?? []).length, 1);
assert.ok(home.includes(renderToStaticMarkup(React.createElement(HorneoCase))), 'genuine Horneo section untouched');
for (const index of [5, 6]) assert.ok(home.includes(renderToStaticMarkup(React.createElement(CommercialSection, { section: source.sections[index], index }))), 'collaborations and closing CTA untouched');
assert.equal((home.match(/id="funcionamiento"/g) ?? []).length, 1);
assert.equal((info.match(/id="funcionamiento"/g) ?? []).length, 1);
assert.equal((home.match(/03-funcionamiento-escritorio\.svg/g) ?? []).length, 1);
assert.equal((info.match(/03-funcionamiento-compacto-escritorio\.svg/g) ?? []).length, 1);
assert.ok(!info.includes(`<h2>${commercialCopy['/info-faqs'].sections[0].title}</h2>`), 'equivalent four-step overview is not duplicated');
for (const image of ['04-alimentacion-frio', '05-almacenamiento-especializado', '02-supervision-aviso']) {
  assert.ok(!home.includes(image)); assert.ok(!info.includes(image), 'repetitive illustration is omitted from the revised journey');
}
assert.match(home, /href="\/info-faqs#funcionamiento">Ver cómo funciona/);
assert.equal((info.match(/<details/g) ?? []).length, 7, 'necessary normative/contractual FAQs retained; repeated answers integrated into the journey');
console.log('Short home: detail remains off home, diagram and retained sections preserved; how-it-works follows the revised brief');
