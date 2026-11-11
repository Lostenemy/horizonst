import { CommercialVisual, CommercialOperationDiagram } from '../components/CommercialVisual';
import { PublicNav, PublicFooter, HorneoCase } from '../components/PublicMarketingShell';
import ConsultationForm from '../components/ConsultationForm';
import { commercialCopy, type CommercialPath } from '../lib/commercial-copy';
import { CommercialAppPreview } from '../components/CommercialAppPreview';
import type { ConsultationProfile } from '../../../src/resources/contact-context';

type Link = { label: string; href: string };
type Section = { title: string; paragraphs: readonly string[]; items: readonly string[];
  cards: readonly { title: string; paragraphs: readonly string[]; links: readonly Link[] }[]; links: readonly Link[] };
const links = (values: readonly Link[]) => <div className="actions">{values.map((link, index) => <a className={index ? 'btn ghost' : 'btn'} key={link.href + link.label} href={link.href}>{link.label}</a>)}</div>;
export const homeAdvantages = [
  'Detecta la presencia sin fichajes manuales en cada entrada y salida.',
  'Avisa al trabajador antes del límite de permanencia configurado.',
  'Reúne registros para el seguimiento preventivo.'
] as const;
export const infoSteps = [
  ['El trabajador lleva su dispositivo.', 'La presencia se detecta automáticamente, sin fichar cada entrada y salida.'],
  ['El sistema controla los tiempos.', 'Registra la permanencia y controla los descansos según la configuración aplicable a la instalación.'],
  ['El trabajador recibe el aviso preventivo.', 'Su dispositivo vibra y pita al aproximarse al límite de permanencia configurado.'],
  ['El supervisor consulta los registros.', 'La aplicación web permite revisar la permanencia y las incidencias registradas.']
] as const;
export function CommercialSection({ section, index, diagram = false }: { section: Section; index: number; diagram?: boolean }) {
  const faq = section.cards.length > 0 && section.cards.every(card => card.title.startsWith('¿'));
  return <section className={`lp-section ${faq ? 'lp-faq' : ''}`} id={diagram ? 'funcionamiento' : `contenido-${index}`}>
    {section.title && <h2>{section.title}</h2>}
    {!(diagram && section.paragraphs.length === section.items.length) && section.paragraphs.map(text => <p key={text}>{text}</p>)}
    {!!section.items.length && <ol className="commercial-items">{section.items.map((text, itemIndex) => <li key={text}>{text.replace(/^Paso \d+ — /, '')}{diagram && section.paragraphs.length === section.items.length && <p>{section.paragraphs[itemIndex]}</p>}</li>)}</ol>}
    {diagram && <><CommercialOperationDiagram /><p>La instalación requiere alimentación eléctrica y conexión a Internet.</p></>}
    <div className={faq ? '' : 'lp-grid three'}>{section.cards.map(card => faq
      ? <details key={card.title}><summary>{card.title}</summary>{card.paragraphs.map(text => <p key={text}>{text}</p>)}{links(card.links)}</details>
      : <article className="lp-card" key={card.title}><h3>{card.title}</h3>{card.paragraphs.map(text => <p key={text}>{text}</p>)}{links(card.links)}</article>)}</div>
    {links(section.links)}
  </section>;
}

export function CommercialHome() {
  const page = commercialCopy['/'];
  return <main className="public-landing commercial-v3"><PublicNav />
    <section className="lp-hero lp-revised-hero"><div><h1>{page.title}</h1><ol className="commercial-home-advantages">{homeAdvantages.map(text => <li key={text}>{text}</li>)}</ol>{links(page.actions)}</div><video className="commercial-hero-video" controls playsInline preload="metadata" aria-label="Vídeo de presentación de Horizon Smartracking"><source src="/videos/horizonst-presentacion.mp4" type="video/mp4" />Tu navegador no permite reproducir este vídeo.</video></section>
    <section className="lp-section" id="funcionamiento" aria-label="Esquema conceptual de funcionamiento"><CommercialOperationDiagram /><p>Los límites de permanencia y los descansos son una obligación. Su seguimiento diario necesita un control fiable. <a href="/info-faqs#normativa">Consultar normativa y posibles sanciones</a>.</p>{links(page.sections[2].links)}</section>
    <HorneoCase />
    {page.sections.slice(5).map((section, index) => <CommercialSection key={section.title} section={section} index={index + 5} />)}<PublicFooter /></main>;
}

export function CommercialInfo() {
  const page = commercialCopy['/info-faqs'];
  // Keep normative/contractual answers intact; prominent steps/notice blocks replace repeated FAQs.
  const faq = { ...page.sections[2], cards: [2, 3, 5, 8, 9, 10, 11].map(index => page.sections[2].cards[index]!) };
  return <main className="public-landing commercial-v3 commercial-info"><PublicNav />
    <section className="lp-section commercial-info-intro"><h1>{page.title}</h1><p>{page.intro}</p>
      <p>ST viene de Smartracking: seguimiento automático de presencia, permanencia y descansos para facilitar el control diario y la revisión de los registros.</p>{links(page.actions)}</section>
    <section className="lp-section" id="funcionamiento" aria-labelledby="info-process-title"><h2 id="info-process-title">Funcionamiento en cuatro pasos</h2>
      <ol className="commercial-process">{infoSteps.map(([title, text]) => <li key={title}><strong>{title}</strong><p>{text}</p></li>)}</ol><CommercialOperationDiagram compact /></section>
    <section className="lp-section commercial-notices" aria-label="Aviso preventivo y SOS">
      <article className="commercial-personal-notice"><h2>Aviso preventivo al trabajador</h2><p>El dispositivo vibra y pita cuando se aproxima al límite de permanencia configurado.</p></article>
      <article className="commercial-sos-notice"><h2>SOS al supervisor</h2><p>Si el trabajador pulsa SOS para solicitar ayuda, el supervisor recibe la alerta en la aplicación web y actúa conforme al procedimiento del centro.</p></article>
    </section>
    <CommercialAppPreview />
    <section className="lp-section commercial-installation" aria-labelledby="info-installation-title"><div><h2 id="info-installation-title">Qué se instala</h2>
      <ul><li><strong>Dispositivo personal.</strong> El trabajador lo lleva durante su actividad en la cámara.</li><li><strong>Receptor exterior.</strong> Se instala fuera de la cámara y recibe alimentación mediante el cable de red (PoE).</li><li><strong>Antena interior.</strong> Se introduce en la cámara a través de una perforación preparada para la instalación.</li></ul>
      <p>Se necesita alimentación eléctrica y conexión a Internet. Antes de definir la instalación, revisamos los puntos de alimentación y conexión, la cobertura y la organización del trabajo.</p></div><CommercialVisual scene="installation" /></section>
    <section className="lp-section"><h2>Información disponible para revisar lo ocurrido</h2><p>Consulta los registros e informes de permanencia e incidencias para el seguimiento preventivo, las revisiones internas y la preparación documental.</p>
      <p>Reduce la necesidad de reunir anotaciones y reconstruir registros para preparar informes.</p><a href="/planes">Consultar planes</a></section>
    <section className="lp-section" id="normativa" aria-labelledby="normativa-title"><h2 id="normativa-title">Normativa y posibles sanciones</h2>
      <p>Los límites de permanencia y los descansos son una obligación. Su seguimiento diario necesita un control fiable.</p>
      <p>El <a href="https://www.boe.es/buscar/act.php?id=BOE-A-1995-21346#a31">artículo 31 del Real Decreto 1561/1995</a> establece límites de permanencia y descansos según la temperatura de la cámara. Horizon Smartracking te ayuda a seguir los tiempos, avisar al trabajador y reunir registros para revisar tu gestión preventiva.</p>
      <p>La empresa debe proteger a sus trabajadores frente a los riesgos del trabajo. Automatizar el seguimiento facilita gestionar estas obligaciones junto con las medidas de vuestro servicio de prevención. Consulta los artículos <a href="https://www.boe.es/buscar/act.php?id=BOE-A-1995-24292#a14">14</a> y <a href="https://www.boe.es/buscar/act.php?id=BOE-A-1995-24292#a16">16 de la Ley 31/1995</a>.</p>
      <p>Los incumplimientos pueden dar lugar a sanciones según los hechos y su calificación. Las infracciones graves sobre jornada y descansos se sancionan con multas de 751 a 7.500 €. En prevención de riesgos laborales, las graves van de 2.451 a 49.180 € y las muy graves, de 49.181 a 983.736 €. Consulta los artículos <a href="https://www.boe.es/buscar/act.php?id=BOE-A-2000-15060#a7">7.5</a>, <a href="https://www.boe.es/buscar/act.php?id=BOE-A-2000-15060#a12">12</a>, <a href="https://www.boe.es/buscar/act.php?id=BOE-A-2000-15060#a13">13</a> y <a href="https://www.boe.es/buscar/act.php?id=BOE-A-2000-15060#a40">40 de la LISOS</a>.</p>
      <p>Son rangos legales generales: la calificación y cuantía dependen de cada caso. No utilizar Horizon Smartracking no constituye por sí mismo una infracción; contratarlo tampoco garantiza el cumplimiento ni la ausencia de sanciones.</p>
      <p>Fuentes oficiales revisadas el 5 de noviembre de 2026.</p>
    </section>
    <CommercialSection section={faq} index={15} />
    <section className="lp-section lp-final-cta"><h2>Veamos qué necesita tu instalación</h2>{links(page.actions)}</section><PublicFooter /></main>;
}

export function PublicCollaborations({ path = '/colaboraciones' }: { path?: Extract<CommercialPath, `/colaboraciones${string}`> }) {
  const page = commercialCopy[path];
  const profile = path === '/colaboraciones' ? undefined : path.split('/')[2] as ConsultationProfile;
  return <main className="public-landing commercial-v3"><PublicNav />
    <section className="lp-hero lp-revised-hero"><div><p className="eyebrow">{page.eyebrow || 'Colaboraciones'}</p><h1>{page.title}</h1><p>{page.intro}</p>{links(page.actions)}</div><CommercialVisual scene={profile === 'asesorias-prl' ? 'preparation' : 'installation'} /></section>
    {page.sections.map((section, index) => <CommercialSection key={section.title} section={section} index={index} />)}
    <section className="lp-section" id="consulta"><ConsultationForm initialPurpose="colaboracion" fixedProfile={profile} /></section><PublicFooter /></main>;
}
