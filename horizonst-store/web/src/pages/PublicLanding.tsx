import { FormEvent, useState } from 'react';
import { customerAccessUrl } from '../lib/domains';

export const publicWebPlans = [
  { name: 'Plan web Starter', price: '580 € PVP + IVA', description: 'Para operaciones que comienzan a digitalizar sus controles.' },
  { name: 'Plan web Professional', price: '800 € PVP + IVA', description: 'Para equipos que necesitan ampliar cobertura y trazabilidad.' },
  { name: 'Plan web Enterprise', price: '1.200 € PVP + IVA', description: 'Para operaciones con mayor capacidad y configuración comercial avanzada.' }
];

export const hardwarePacks = [
  { name: 'Pack Starter', items: ['5 puntos de comunicación inalámbrica', '5 antenas y accesorios de instalación', '1 inyector de alimentación PoE', '10 dispositivos personales inalámbricos con alarma'] },
  { name: 'Pack Professional', items: ['10 puntos de comunicación inalámbrica', '10 antenas y accesorios de instalación', '2 inyectores de alimentación PoE', '20 dispositivos personales inalámbricos con alarma'] },
  { name: 'Pack Enterprise', items: ['20 puntos de comunicación inalámbrica', '20 antenas y accesorios de instalación', '4 inyectores de alimentación PoE', '40 dispositivos personales inalámbricos con alarma'] }
];

export const faqItems = [
  { question: '¿Cómo funciona HorizonST?', answer: 'La infraestructura de monitorización inalámbrica centraliza alertas, historial y trazabilidad en una plataforma privada.' },
  { question: '¿Ayuda con APPCC?', answer: 'Facilita evidencias y registros para los controles. Cada empresa debe validar su propio plan APPCC.' },
  { question: '¿Dónde están las condiciones comerciales?', answer: 'Los packs y condiciones comerciales están disponibles para usuarios registrados en HorizonST Store.' }
];

export const calculatePotentialSavings = (hoursPerWeek: number, hourlyCost: number, incidentsPerYear: number, incidentCost: number) =>
  Math.round((Math.max(0, hoursPerWeek) * Math.max(0, hourlyCost) * 52 * 0.35) + (Math.max(0, incidentsPerYear) * Math.max(0, incidentCost) * 0.2));

export function PublicNav() {
  return <nav className="lp-nav" aria-label="Navegación pública">
    <a className="lp-brand" href="/">HorizonST</a>
    <a href="/">Inicio</a><a href="/planes">Planes</a><a href="/info-faqs">INFO/FAQS</a>
    <a className="btn secondary" href={customerAccessUrl}>Acceso clientes</a>
  </nav>;
}

function PublicFooter() {
  return <footer className="lp-footer"><p>HorizonST · Monitorización inteligente para cámaras frigoríficas</p><nav aria-label="Legal"><a href="mailto:comercial@horizonst.es">Contacto</a><a href="/aviso-legal">Aviso legal</a><a href="/privacidad">Privacidad</a></nav></footer>;
}

function GuideForm() {
  const [email, setEmail] = useState('');
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [website, setWebsite] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const submit = async (event: FormEvent) => {
    event.preventDefault(); setStatus('sending');
    try {
      const response = await fetch('/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'appcc_guide', email, privacyAccepted, website }) });
      if (!response.ok) throw new Error('guide_failed');
      setStatus('sent'); setEmail(''); setPrivacyAccepted(false); setWebsite('');
    } catch { setStatus('error'); }
  };
  return <form className="lp-form" onSubmit={submit} data-lead-source="appcc_guide">
    <h3>Descarga de guía APPCC</h3>
    <label>Email profesional<input required type="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
    <label className="lp-honeypot" aria-hidden="true">Web<input tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} /></label>
    <label className="lp-privacy"><input required type="checkbox" checked={privacyAccepted} onChange={(event) => setPrivacyAccepted(event.target.checked)} /> He leído y acepto la <a href="/privacidad">política de privacidad</a>.</label>
    <button type="submit" disabled={status === 'sending'}>{status === 'sending' ? 'Enviando...' : 'Solicitar guía APPCC 2026'}</button>
    {status === 'sent' && <p className="success">Revisa tu correo para acceder a la guía.</p>}
    {status === 'error' && <p className="error">No se pudo enviar la guía. Inténtalo de nuevo más tarde.</p>}
  </form>;
}

function SavingsCalculator() {
  const [hours, setHours] = useState(6); const [hourlyCost, setHourlyCost] = useState(22); const [incidents, setIncidents] = useState(2); const [incidentCost, setIncidentCost] = useState(900);
  const estimate = calculatePotentialSavings(hours, hourlyCost, incidents, incidentCost);
  return <div className="lp-calculator" aria-label="Calculadora de ahorro potencial">
    <label>Horas semanales en controles manuales<input type="number" min="0" value={hours} onChange={(event) => setHours(Number(event.target.value))} /></label><label>Coste hora estimado<input type="number" min="0" value={hourlyCost} onChange={(event) => setHourlyCost(Number(event.target.value))} /></label><label>Incidencias anuales evitables<input type="number" min="0" value={incidents} onChange={(event) => setIncidents(Number(event.target.value))} /></label><label>Coste medio por incidencia<input type="number" min="0" value={incidentCost} onChange={(event) => setIncidentCost(Number(event.target.value))} /></label>
    <p className="lp-estimate">Ahorro potencial orientativo: <strong>{estimate.toLocaleString('es-ES')} €/año</strong></p><small>No es un resultado garantizado. Es una estimación para priorizar una revisión operativa.</small>
  </div>;
}

export function PublicHome() {
  return <main className="public-landing"><PublicNav /><section className="lp-hero"><p className="eyebrow">Trazabilidad, frío y cumplimiento APPCC</p><h1>Protege a tu equipo y cumple APPCC con monitorización inteligente.</h1><p>Controla exposiciones al frío, recibe alertas automáticas y mantén la trazabilidad en tiempo real.</p><div className="actions"><a className="btn" href="#appcc">Descargar guía APPCC</a><a className="btn ghost" href="/planes">Ver planes</a></div></section>
    <section className="lp-section"><p className="eyebrow">El problema</p><h2>Controles manuales e incidencias detectadas demasiado tarde.</h2><div className="lp-grid three"><article><h3>Riesgo operativo</h3><p>Información crítica sin contexto suficiente.</p></article><article><h3>Tiempo administrativo</h3><p>Registros dispersos que no escalan.</p></article><article><h3>Auditoría débil</h3><p>Evidencias difíciles de recuperar.</p></article></div></section>
    <section className="lp-section"><p className="eyebrow">Beneficios</p><h2>Menos tareas manuales y más capacidad de reacción.</h2><div className="lp-grid three"><article><h3>Protección del equipo</h3><p>Detecta situaciones que requieren intervención.</p></article><article><h3>Alertas accionables</h3><p>Actúa antes de que una incidencia escale.</p></article><article><h3>Trazabilidad APPCC</h3><p>Historial centralizado para tus controles críticos.</p></article></div></section>
    <section id="appcc" className="lp-section split"><div><p className="eyebrow">Guía APPCC</p><h2>Guía APPCC 2026 para cámaras frigoríficas.</h2><p>Revisa controles críticos, evidencias y oportunidades de automatización.</p></div><GuideForm /></section>
    <section className="lp-section"><p className="eyebrow">Planes web</p><h2>Planes adaptados al tamaño de tu operación.</h2><div className="lp-grid three">{publicWebPlans.map((plan) => <article className="lp-card" key={plan.name}><h3>{plan.name}</h3><p className="lp-price">{plan.price}</p><p>{plan.description}</p></article>)}</div><div className="actions"><a className="btn" href="/planes">Ver todos los planes y packs</a><a className="btn ghost" href={customerAccessUrl}>Acceder a la zona registrada</a></div></section><PublicFooter /></main>;
}

export function PublicPlans() {
  return <main className="public-landing"><PublicNav /><section className="lp-section"><p className="eyebrow">Planes</p><h1>Planes web y packs para tu operación.</h1><div className="lp-grid three">{publicWebPlans.map((plan) => <article className="lp-card" key={plan.name}><h2>{plan.name}</h2><p className="lp-price">{plan.price}</p><p>{plan.description}</p></article>)}</div><h2 className="lp-subheading">Packs de infraestructura de monitorización inalámbrica.</h2><div className="lp-grid three">{hardwarePacks.map((pack) => <article className="lp-card" key={pack.name}><h2>{pack.name}</h2><ul>{pack.items.map((item) => <li key={item}>{item}</li>)}</ul><p>El precio y las condiciones comerciales están disponibles en la zona registrada.</p><a className="btn" href={customerAccessUrl}>Acceso clientes</a></article>)}</div></section><PublicFooter /></main>;
}

export function PublicInfoFaqs() {
  return <main className="public-landing"><PublicNav /><section className="lp-section"><p className="eyebrow">Información</p><h1>Información para mejorar tus controles.</h1><h2>Funcionamiento general</h2><p>Los dispositivos inalámbricos recogen datos operativos y los puntos de comunicación inalámbrica los envían a una plataforma privada con alertas e historial.</p><h2>Beneficios detallados</h2><p>HorizonST ayuda a centralizar controles, reaccionar antes ante incidencias y preparar evidencias para la trazabilidad y APPCC.</p><h2>Trazabilidad y APPCC</h2><p>Los registros facilitan la revisión de controles críticos. Cada empresa es responsable de validar su propio plan APPCC.</p><h2>Calculadora de ahorro potencial</h2><SavingsCalculator /><h2 className="lp-subheading">Confianza</h2><p>Implantación progresiva y acceso privado para clientes, distribuidores y administradores.</p><h2 className="lp-subheading">Preguntas frecuentes</h2><div className="lp-grid two">{faqItems.map((item) => <article className="lp-card" key={item.question}><h3>{item.question}</h3><p>{item.answer}</p></article>)}</div></section><PublicFooter /></main>;
}
