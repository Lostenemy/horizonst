import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { CommercialHome, CommercialInfo, homeAdvantages, infoSteps } from '../web/src/pages/CommercialContent.js';
import { commercialCopy } from '../web/src/lib/commercial-copy.js';
const require = createRequire(new URL('../web/package.json', import.meta.url));
const { renderToStaticMarkup } = require('react-dom/server') as typeof import('react-dom/server');
const home = renderToStaticMarkup(CommercialHome()); const info = renderToStaticMarkup(CommercialInfo());
assert.deepEqual(homeAdvantages, [
  'Detecta la presencia sin fichajes manuales en cada entrada y salida.',
  'Avisa al trabajador antes del límite de permanencia configurado.',
  'Reúne registros para el seguimiento preventivo.'
]);
const numbered = home.match(/<ol class="commercial-home-advantages">(.*?)<\/ol>/s)?.[1] ?? '';
assert.equal((numbered.match(/<li/g) ?? []).length, 3);
for (const text of homeAdvantages) assert.ok(numbered.includes(text));
assert.ok(home.indexOf('</ol>') < home.indexOf('>Consultar mi instalación<'));
assert.match(home, /<h1>Horizon Smartracking controla automáticamente la permanencia y los descansos en tus cámaras congeladoras\.<\/h1>/);
assert.doesNotMatch(home, /Avisa a tus trabajadores antes del límite configurado y reúne/);
assert.equal((home.match(/Smartracking/g) ?? []).length, 3, 'includes the accessible video label');
assert.equal((info.match(/Smartracking/g) ?? []).length, 5);
assert.doesNotMatch(home, /commercial-brand-line|Horizon Smartracking para el control/);
assert.doesNotMatch(home + info, /Hosizon|Smartaracking|· Smartracking/);
for (const markup of [home, info]) {
  const body = markup.replace(/<nav\b[^>]*>.*?<\/nav>/s, '').replace(/<footer\b[^>]*>.*?<\/footer>/s, '');
  assert.doesNotMatch(body, /HorizonST/, 'only content uses the requested product spelling');
  assert.match(body, /Horizon Smartracking/);
  assert.match(markup, /class="lp-brand" href="\/">HorizonST<\/a>/, 'navigation brand unchanged');
  assert.match(markup, /<footer[^>]*><p>HorizonST ·/, 'footer brand unchanged');
}
assert.match(info, /ST viene de Smartracking: seguimiento automático de presencia, permanencia y descansos/);
const steps = info.match(/<ol class="commercial-process">(.*?)<\/ol>/s)?.[1] ?? '';
assert.equal((steps.match(/<li/g) ?? []).length, 4);
for (const [title, description] of infoSteps) { assert.ok(steps.includes(title)); assert.ok(steps.includes(description)); }
assert.equal((info.match(/id="funcionamiento"/g) ?? []).length, 1);
const personal = info.match(/<article class="commercial-personal-notice">(.*?)<\/article>/s)?.[1] ?? '';
const sos = info.match(/<article class="commercial-sos-notice">(.*?)<\/article>/s)?.[1] ?? '';
assert.match(personal, /vibra y pita/); assert.doesNotMatch(personal, /supervisor|SOS/);
assert.match(sos, /Si el trabajador pulsa SOS/); assert.match(sos, /supervisor recibe la alerta en la aplicación web/); assert.doesNotMatch(sos, /vibra|pita/);
assert.match(info, /cable de red \(PoE\)/); assert.match(info, /a través de una perforación preparada para la instalación/);
assert.match(info, /Dispositivo personal\.<\/strong> El trabajador lo lleva/);
assert.match(info, /Se necesita alimentación eléctrica y conexión a Internet/);
assert.match(info, /03-funcionamiento-compacto-escritorio\.svg/);
assert.doesNotMatch(info, /03-funcionamiento-escritorio\.svg/);
assert.match(info, /Información disponible para revisar lo ocurrido/); assert.match(info, /href="\/planes">Consultar planes/);
for (const index of [2, 3, 5, 8, 9, 10, 11]) {
  const card = commercialCopy['/info-faqs'].sections[2].cards[index]!;
  assert.ok(info.includes(card.title)); for (const text of card.paragraphs) assert.ok(info.includes(text), 'normative and contractual detail preserved');
}
assert.match(info, /BOE-A-1995-21346#a31/);
assert.equal((info.match(/<img /g) ?? []).length, 3, 'diagram, installation illustration and one selected application image');
assert.match(home, /href="\/info-faqs#normativa"/);
assert.match(info, /id="normativa"/);
assert.match(info, /751 a 7\.500/);
assert.match(info, /No utilizar Horizon Smartracking no constituye por sí mismo una infracción/);
assert.match(info, /contratarlo tampoco garantiza el cumplimiento/);
assert.match(info, /imágenes estáticas, no datos en directo/);
assert.match(info, /aria-label="Seleccionar vista de la aplicación"/);
assert.match(info, /Ampliar imagen/);
for (const file of ['04-alimentacion-frio', '05-almacenamiento-especializado', '02-supervision-aviso']) assert.ok(!info.includes(file));
for (const title of ['¿Cómo seguís hoy los tiempos dentro de la cámara?', 'Del control diario a los registros que necesitas', 'Dedica menos esfuerzo a reunir la información']) assert.ok(!info.includes(title), 'no duplicate explanatory blocks');
assert.doesNotMatch(home + info, /comisi[oó]n|remuneraci[oó]n|GPS|localización exacta|capacidades predictivas/i);
console.log('Smartracking: ordered home benefits, concise meaning, four-step journey, distinct notifications, images and necessary FAQ passed');
