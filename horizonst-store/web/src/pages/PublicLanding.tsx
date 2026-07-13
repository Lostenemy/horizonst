import { FormEvent, useState } from 'react';
import { customerAccessUrl } from '../lib/domains';

export const publicWebPlans = [
  { name: 'Plan Starter', price: '580 € PVP + IVA', description: 'Para operaciones que comienzan a digitalizar su supervisión.' },
  { name: 'Plan Professional', price: '800 € PVP + IVA', description: 'Para equipos que necesitan ampliar cobertura y trazabilidad.' },
  { name: 'Plan Enterprise', price: '1.200 € PVP + IVA', description: 'Para operaciones con mayor capacidad y configuración comercial avanzada.' }
];

export const hardwarePacks = [
  { name: 'Pack Starter', items: ['5 puntos de comunicación inalámbrica', '5 antenas y accesorios de instalación', '1 inyector de alimentación PoE', '10 dispositivos personales inalámbricos con alarma'] },
  { name: 'Pack Professional', items: ['10 puntos de comunicación inalámbrica', '10 antenas y accesorios de instalación', '2 inyectores de alimentación PoE', '20 dispositivos personales inalámbricos con alarma'] },
  { name: 'Pack Enterprise', items: ['20 puntos de comunicación inalámbrica', '20 antenas y accesorios de instalación', '4 inyectores de alimentación PoE', '40 dispositivos personales inalámbricos con alarma'] }
];

export const faqItems = [
  ['¿Cómo funciona HorizonST?', 'La solución registra accesos, supervisa permanencias y centraliza alertas e incidencias en un acceso privado.'],
  ['¿Qué se controla en una cámara congeladora?', 'La presencia, el tiempo de permanencia, las alertas definidas por la operación y el historial de incidencias.'],
  ['¿Cómo se definen los tiempos de permanencia?', 'Cada centro los define en su evaluación de riesgos, procedimientos internos y organización del trabajo. No existen tiempos universales.'],
  ['¿Qué ocurre cuando se genera una alerta?', 'El equipo responsable recibe el aviso y aplica el procedimiento interno de comprobación, intervención y registro.'],
  ['¿Se necesita realizar obras?', 'La implantación se estudia según cada cámara y centro para adaptar la solución a la operación existente.'],
  ['¿Dónde se consultan los registros?', 'En el acceso privado de HorizonST, donde el equipo autorizado puede revisar el historial operativo.'],
  ['¿Cómo se accede a los planes?', 'Puedes consultar las opciones disponibles en la página de planes y solicitar orientación comercial.'],
  ['¿Puede adaptarse a varias cámaras o centros?', 'Sí. La solución puede crecer de forma progresiva según el número de cámaras y la organización.']
];

export const calculatePotentialSavings = (hoursPerWeek: number, hourlyCost: number, incidentsPerYear: number, incidentCost: number) =>
  Math.round((Math.max(0, hoursPerWeek) * Math.max(0, hourlyCost) * 52 * 0.35) + (Math.max(0, incidentsPerYear) * Math.max(0, incidentCost) * 0.2));

export function PublicNav() {
  return <nav className="lp-nav" aria-label="Navegación pública">
    <a className="lp-brand" href="/">HorizonST</a>
    <div className="lp-nav-links"><a href="/planes">Planes</a><a href="/info-faqs">INFO/FAQS</a></div>
    <a className="btn secondary" href={customerAccessUrl}>Acceso clientes</a>
  </nav>;
}

function PublicFooter() {
  return <footer className="lp-footer"><p>HorizonST · Supervisión operativa para cámaras congeladoras</p><nav aria-label="Legal"><a href="mailto:comercial@horizonst.es">Contacto</a><a href="/aviso-legal">Aviso legal</a><a href="/privacidad">Privacidad</a></nav></footer>;
}

function GuideForm() {
  const [email, setEmail] = useState(''); const [privacyAccepted, setPrivacyAccepted] = useState(false); const [website, setWebsite] = useState(''); const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const submit = async (event: FormEvent) => { event.preventDefault(); setStatus('sending'); try { const response = await fetch('/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'appcc_guide', email, privacyAccepted, website }) }); if (!response.ok) throw new Error('guide_failed'); setStatus('sent'); setEmail(''); setPrivacyAccepted(false); setWebsite(''); } catch { setStatus('error'); } };
  return <form className="lp-form" onSubmit={submit} data-lead-source="appcc_guide">
    <p className="eyebrow">Recurso gratuito</p><h2>Guía 2026 para la seguridad en cámaras congeladoras</h2><p>Un documento práctico sobre accesos, permanencias, alertas e incidencias.</p>
    <label>Email profesional<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
    <label className="lp-honeypot" aria-hidden="true">Web<input tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} /></label>
    <label className="lp-privacy"><input required type="checkbox" checked={privacyAccepted} onChange={(event) => setPrivacyAccepted(event.target.checked)} /> He leído y acepto la <a href="/privacidad">política de privacidad</a>.</label>
    <button type="submit" disabled={status === 'sending'}>{status === 'sending' ? 'Enviando...' : 'Recibir la guía por email'}</button>
    {status === 'sent' && <p className="success">Revisa tu correo para acceder a la guía.</p>}{status === 'error' && <p className="error">No se pudo enviar la guía. Inténtalo de nuevo más tarde.</p>}
  </form>;
}

function SavingsCalculator() {
  const [hours, setHours] = useState(6); const [hourlyCost, setHourlyCost] = useState(22); const [incidents, setIncidents] = useState(2); const [incidentCost, setIncidentCost] = useState(900); const estimate = calculatePotentialSavings(hours, hourlyCost, incidents, incidentCost);
  return <section className="lp-calculator" aria-label="Calculadora de ahorro potencial"><div><p className="eyebrow">Calculadora orientativa</p><h2>Estima el margen de mejora operativo</h2><p>Introduce una referencia de tu operación. El resultado no constituye una previsión ni una garantía.</p></div><div className="lp-calculator-fields"><label>Horas semanales en controles manuales<input type="number" min="0" value={hours} onChange={(event) => setHours(Number(event.target.value))} /></label><label>Coste hora estimado<input type="number" min="0" value={hourlyCost} onChange={(event) => setHourlyCost(Number(event.target.value))} /></label><label>Incidencias anuales evitables<input type="number" min="0" value={incidents} onChange={(event) => setIncidents(Number(event.target.value))} /></label><label>Coste medio por incidencia<input type="number" min="0" value={incidentCost} onChange={(event) => setIncidentCost(Number(event.target.value))} /></label></div><p className="lp-estimate">Ahorro potencial orientativo <strong>{estimate.toLocaleString('es-ES')} €/año</strong></p></section>;
}

export function PublicHome() {
  return <main className="public-landing"><PublicNav /><section className="lp-hero"><p className="eyebrow">Seguridad en frío extremo</p><h1>Supervisa mejor a quienes trabajan en cámaras congeladoras.</h1><p>Controla permanencias, recibe alertas y conserva un historial operativo para actuar con mayor rapidez.</p><div className="actions"><a className="btn" href="#guia">Recibir la guía</a><a className="btn ghost" href="/info-faqs">Cómo funciona</a></div></section>
    <section className="lp-section lp-intro"><p className="eyebrow">Una operación más preparada</p><h2>Visibilidad cuando más importa.</h2><p>HorizonST ayuda a organizar el control de accesos y tiempos de permanencia mediante tecnologías inalámbricas, con alertas y trazabilidad pensadas para el equipo responsable.</p></section>
    <section id="guia" className="lp-section"><GuideForm /></section>
    <section className="lp-section lp-plans-cta"><p>¿Quieres conocer las soluciones disponibles?</p><h2>Consulta los planes de HorizonST.</h2><a className="btn" href="/planes">Ver planes</a></section><PublicFooter /></main>;
}

export function PublicPlans() { return <main className="public-landing"><PublicNav /><section className="lp-section"><p className="eyebrow">Planes</p><h1>Planes de servicios Web</h1><div className="lp-grid three">{publicWebPlans.map((plan) => <article className="lp-card" key={plan.name}><h2>{plan.name}</h2><p className="lp-price">{plan.price}</p><p>{plan.description}</p></article>)}</div><h2 className="lp-subheading">Planes de hardware</h2><div className="lp-grid three">{hardwarePacks.map((pack) => <article className="lp-card" key={pack.name}><h2>{pack.name}</h2><ul>{pack.items.map((item) => <li key={item}>{item}</li>)}</ul><p>El precio y las condiciones comerciales están disponibles en la zona registrada.</p><a className="btn" href={customerAccessUrl}>Acceso clientes</a></article>)}</div></section><PublicFooter /></main>; }

export function PublicInfoFaqs() { return <main className="public-landing"><PublicNav /><section className="lp-info-hero"><p className="eyebrow">Información y preguntas frecuentes</p><h1>Todo lo que necesitas saber sobre HorizonST</h1><p>Consulta cómo funciona la solución, qué problemas ayuda a resolver y las respuestas a las dudas más habituales.</p></section>
  <section className="lp-section"><p className="eyebrow">El problema</p><h2>Situaciones que necesitan más visibilidad.</h2><div className="lp-grid three"><article className="lp-card lp-icon-card"><span>01</span><h3>Permanencias sin controlar</h3><p>Sin una referencia operativa clara, detectar una permanencia prolongada depende de revisiones manuales.</p></article><article className="lp-card lp-icon-card"><span>02</span><h3>Alarmas tardías</h3><p>Una señal sin aviso estructurado puede retrasar la comprobación y la intervención necesaria.</p></article><article className="lp-card lp-icon-card"><span>03</span><h3>Registros dispersos</h3><p>La información repartida dificulta reconstruir una incidencia y mejorar el procedimiento.</p></article></div></section>
  <section className="lp-section"><p className="eyebrow">Beneficios</p><h2>Información útil para reaccionar mejor.</h2><div className="lp-grid four"><article className="lp-card"><h3>Mayor capacidad de reacción</h3><p>Avisos para que el equipo responsable pueda comprobar la situación.</p></article><article className="lp-card"><h3>Control de tiempos</h3><p>Supervisión de permanencias según los umbrales internos definidos.</p></article><article className="lp-card"><h3>Trazabilidad operativa</h3><p>Contexto para revisar accesos, alertas e incidencias.</p></article><article className="lp-card"><h3>Historial centralizado</h3><p>Consulta organizada desde un acceso privado.</p></article></div></section>
  <section className="lp-section"><p className="eyebrow">Cómo funciona</p><h2>Un proceso claro, de la entrada al registro.</h2><ol className="lp-steps"><li><strong>El trabajador accede.</strong><span>El acceso queda identificado en la operación.</span></li><li><strong>El sistema supervisa.</strong><span>Se controla la permanencia conforme a los criterios internos.</span></li><li><strong>Se generan alertas.</strong><span>El equipo responsable recibe el aviso cuando corresponde.</span></li><li><strong>La incidencia queda registrada.</strong><span>El historial facilita la revisión posterior.</span></li></ol></section>
  <section className="lp-section"><SavingsCalculator /></section>
  <section className="lp-section lp-faq"><p className="eyebrow">FAQ</p><h2>Preguntas frecuentes</h2><div>{faqItems.map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div></section>
  <section className="lp-section lp-final-cta"><p>¿Quieres conocer la solución adecuada para tu operación?</p><h2>Consulta los planes o accede a la zona de clientes.</h2><div className="actions"><a className="btn" href="/planes">Ver planes</a><a className="btn ghost" href={customerAccessUrl}>Acceso clientes</a></div></section><PublicFooter /></main>; }
