import { FormEvent, useState } from 'react';
import { customerAccessUrl } from '../lib/domains';

type LeadSource = 'demo' | 'appcc_guide';
type LeadFormState = { fullName: string; companyName: string; email: string; phone: string; message: string; interest: string };

const emptyLeadForm: LeadFormState = { fullName: '', companyName: '', email: '', phone: '', message: '', interest: '' };

export const landingSections = [
  'hero',
  'problem',
  'solution',
  'benefits',
  'appcc-guide',
  'savings-calculator',
  'private-catalog',
  'trust',
  'faq',
  'final-cta'
] as const;

export const privatePlanMessages = [
  { name: 'Planes adaptados', description: 'Planes adaptados al tamaño de tu operación.' },
  { name: 'Propuesta personalizada', description: 'Solicita una demo para recibir una propuesta personalizada.' },
  { name: 'Zona privada', description: 'Consulta catálogo y condiciones accediendo como cliente.' }
];

export const privateHardwareMessages = [
  'Hardware compatible disponible en la zona privada.',
  'Gateways, tags y accesorios se dimensionan según cámaras, cobertura y operación.',
  'El acceso al catálogo requiere entrar como cliente en tienda.horizonst.com.es.'
];

export const faqItems = [
  { question: '¿Cómo funciona HorizonST?', answer: 'Los tags BLE recogen señales operativas y los gateways las envían a una plataforma privada con alertas, historial y trazabilidad.' },
  { question: '¿La instalación requiere obra?', answer: 'La demo permite revisar cobertura, cámaras y puntos críticos antes de proponer una instalación ajustada.' },
  { question: '¿Ayuda con APPCC?', answer: 'Facilita evidencias y registros para tus controles, aunque cada empresa debe validar su propio plan APPCC.' },
  { question: '¿Cómo accedo al catálogo?', answer: 'El catálogo y las condiciones comerciales están disponibles solo dentro de tienda.horizonst.com.es para usuarios registrados.' },
  { question: '¿La demo es gratuita?', answer: 'Puedes solicitar una demo gratuita para analizar tu caso y recibir una propuesta personalizada.' }
];

export const calculatePotentialSavings = (hoursPerWeek: number, hourlyCost: number, incidentsPerYear: number, incidentCost: number) => {
  const manualControlCost = Math.max(0, hoursPerWeek) * Math.max(0, hourlyCost) * 52;
  const incidentExposure = Math.max(0, incidentsPerYear) * Math.max(0, incidentCost);
  return Math.round((manualControlCost * 0.35) + (incidentExposure * 0.2));
};

function LeadForm({ source, title, cta, defaultInterest, requirePhone = false }: { source: LeadSource; title: string; cta: string; defaultInterest: string; requirePhone?: boolean }) {
  const [form, setForm] = useState<LeadFormState>({ ...emptyLeadForm, interest: defaultInterest });
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');

  const update = (field: keyof LeadFormState, value: string) => setForm((current) => ({ ...current, [field]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setStatus('sending');
    try {
      const response = await fetch('/api/leads', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source, ...form })
      });
      if (!response.ok) throw new Error('lead_failed');
      setStatus('sent');
      setForm({ ...emptyLeadForm, interest: defaultInterest });
    } catch {
      setStatus('error');
    }
  };

  return (
    <form className="lp-form" onSubmit={submit} data-lead-source={source}>
      <h3>{title}</h3>
      <label>Nombre y apellidos<input required value={form.fullName} onChange={(event) => update('fullName', event.target.value)} /></label>
      <label>Empresa<input required={source === 'appcc_guide'} value={form.companyName} onChange={(event) => update('companyName', event.target.value)} /></label>
      <label>Email profesional<input required type="email" value={form.email} onChange={(event) => update('email', event.target.value)} /></label>
      <label>Teléfono<input required={requirePhone} value={form.phone} onChange={(event) => update('phone', event.target.value)} /></label>
      <label>Mensaje<textarea rows={3} value={form.message} onChange={(event) => update('message', event.target.value)} /></label>
      <button type="submit" disabled={status === 'sending'}>{status === 'sending' ? 'Enviando...' : cta}</button>
      {status === 'sent' && <p className="success">Solicitud recibida. Te contactaremos para continuar.</p>}
      {status === 'error' && <p className="error">No se pudo registrar la solicitud. Inténtalo de nuevo.</p>}
    </form>
  );
}

function SavingsCalculator() {
  const [hours, setHours] = useState(6);
  const [hourlyCost, setHourlyCost] = useState(22);
  const [incidents, setIncidents] = useState(2);
  const [incidentCost, setIncidentCost] = useState(900);
  const estimate = calculatePotentialSavings(hours, hourlyCost, incidents, incidentCost);

  return (
    <div className="lp-calculator" aria-label="Calculadora de ahorro potencial">
      <label>Horas semanales en controles manuales<input type="number" min="0" value={hours} onChange={(event) => setHours(Number(event.target.value))} /></label>
      <label>Coste hora estimado<input type="number" min="0" value={hourlyCost} onChange={(event) => setHourlyCost(Number(event.target.value))} /></label>
      <label>Incidencias anuales evitables<input type="number" min="0" value={incidents} onChange={(event) => setIncidents(Number(event.target.value))} /></label>
      <label>Coste medio por incidencia<input type="number" min="0" value={incidentCost} onChange={(event) => setIncidentCost(Number(event.target.value))} /></label>
      <p className="lp-estimate">Ahorro potencial orientativo: <strong>{estimate.toLocaleString('es-ES')} €/año</strong></p>
      <small>No es un resultado garantizado. Es una estimación para priorizar una revisión operativa.</small>
    </div>
  );
}

export default function PublicLanding() {
  return (
    <main className="public-landing">
      <nav className="lp-nav" aria-label="Navegación pública">
        <a className="lp-brand" href="#inicio">HorizonST</a>
        <a href="#appcc">Guía APPCC</a>
        <a href="#catalogo-privado">Catálogo privado</a>
        <a className="btn secondary" href={customerAccessUrl}>Acceso clientes</a>
      </nav>

      <section id="inicio" className="lp-hero" data-section="hero">
        <p className="eyebrow">Trazabilidad, frío y cumplimiento APPCC</p>
        <h1>Protege a tu equipo y cumple APPCC con monitorización inteligente de cámaras frigoríficas.</h1>
        <p>Controla tiempos de exposición al frío, recibe alertas automáticas y mantén la trazabilidad en tiempo real.</p>
        <div className="actions">
          <a className="btn" href="#demo">Solicitar demo gratuita</a>
          <a className="btn ghost" href="#solucion">Ver cómo funciona</a>
        </div>
      </section>

      <section className="lp-section" data-section="problem">
        <p className="eyebrow">El problema</p>
        <h2>Controles manuales, incidencias tardías y auditorías con información dispersa.</h2>
        <div className="lp-grid three">
          <article><h3>Riesgo operativo</h3><p>Temperaturas fuera de rango detectadas tarde y sin contexto suficiente.</p></article>
          <article><h3>Tiempo administrativo</h3><p>Equipos rellenando registros en papel o hojas sueltas que no escalan.</p></article>
          <article><h3>Auditoría débil</h3><p>Evidencias difíciles de recuperar cuando llega una inspección o reclamación.</p></article>
        </div>
      </section>

      <section id="solucion" className="lp-section split" data-section="solution">
        <div>
          <p className="eyebrow">La solución</p>
          <h2>Monitorización continua con alertas y registros listos para revisar.</h2>
          <p>Instala tags BLE, conecta gateways y centraliza la información en una plataforma privada con planes adaptados a cada operación.</p>
        </div>
        <ul className="lp-checks">
          <li>Alertas tempranas de temperatura y presencia.</li>
          <li>Historial consultable para auditorías APPCC.</li>
          <li>Escalado desde una cámara hasta operaciones multisede.</li>
        </ul>
      </section>

      <section className="lp-section" data-section="benefits">
        <p className="eyebrow">Beneficios</p>
        <h2>Menos tareas manuales y más capacidad de reacción.</h2>
        <div className="lp-grid three">
          <article><h3>Protección del equipo</h3><p>Control de exposición al frío para detectar situaciones que requieren intervención.</p></article>
          <article><h3>Alertas accionables</h3><p>Notificaciones automáticas para actuar antes de que una incidencia escale.</p></article>
          <article><h3>Trazabilidad APPCC</h3><p>Historial centralizado para revisar evidencias, tendencias y controles críticos.</p></article>
        </div>
      </section>

      <section id="appcc" className="lp-section split" data-section="appcc-guide">
        <div>
          <p className="eyebrow">Guía APPCC</p>
          <h2>Guía APPCC 2026 para cámaras frigoríficas.</h2>
          <p>Solicita una guía orientativa para revisar controles críticos, evidencias y oportunidades de automatización en cámaras frigoríficas.</p>
        </div>
        <LeadForm source="appcc_guide" title="Descarga de guía APPCC" cta="Solicitar guía APPCC 2026" defaultInterest="Guía APPCC 2026 para cámaras frigoríficas" requirePhone />
      </section>

      <section id="calculadora" className="lp-section" data-section="savings-calculator">
        <p className="eyebrow">Calculadora</p>
        <h2>Estima el ahorro potencial antes de solicitar una demo.</h2>
        <SavingsCalculator />
      </section>

      <section id="catalogo-privado" className="lp-section" data-section="private-catalog">
        <p className="eyebrow">Catálogo privado</p>
        <h2>Planes y hardware se consultan dentro de la tienda privada.</h2>
        <div className="lp-grid three">{privatePlanMessages.map((item) => <article className="lp-card" key={item.name}><h3>{item.name}</h3><p>{item.description}</p></article>)}</div>
        <div className="lp-note">{privateHardwareMessages.map((message) => <p key={message}>{message}</p>)}</div>
      </section>

      <section className="lp-section" data-section="trust">
        <p className="eyebrow">Confianza</p>
        <h2>Diseñado para operaciones B2B que necesitan trazabilidad verificable.</h2>
        <p>Implantación progresiva, acceso privado para clientes y distribuidores, y soporte comercial para dimensionar hardware y licencias.</p>
      </section>

      <section className="lp-section" data-section="faq">
        <p className="eyebrow">FAQ</p>
        <h2>Preguntas frecuentes.</h2>
        <div className="lp-grid two">{faqItems.map((item) => <article className="lp-card" key={item.question}><h3>{item.question}</h3><p>{item.answer}</p></article>)}</div>
      </section>

      <section id="demo" className="lp-section split final" data-section="final-cta">
        <div>
          <p className="eyebrow">Siguiente paso</p>
          <h2>Solicita una demo adaptada a tu operación.</h2>
          <p>Cuéntanos tu caso y prepararemos una revisión de necesidades sin presentar resultados garantizados.</p>
        </div>
        <LeadForm source="demo" title="Solicitud de demo" cta="Solicitar demo" defaultInterest="Demo comercial" />
      </section>

      <footer className="lp-footer">
        <p>HorizonST · Monitorización inteligente para cámaras frigoríficas</p>
        <nav aria-label="Legal">
          <a href="mailto:comercial@horizonst.com.es">Contacto</a>
          <a href="/aviso-legal">Aviso legal</a>
          <a href="/privacidad">Privacidad</a>
        </nav>
      </footer>
    </main>
  );
}
