import { FormEvent, useState } from 'react';
import { customerAccessUrl } from '../lib/domains';

type LeadSource = 'demo' | 'appcc_guide';
type LeadFormState = { fullName: string; companyName: string; email: string; phone: string; message: string; interest: string };

const emptyLeadForm: LeadFormState = { fullName: '', companyName: '', email: '', phone: '', message: '', interest: '' };

export const landingSections = [
  'hero',
  'problem',
  'solution',
  'appcc-guide',
  'savings-calculator',
  'plans-pricing',
  'hardware-pricing',
  'trust',
  'final-cta'
] as const;

export const planPricing = [
  { name: 'Starter', price: '580 €/año', limits: 'Hasta 12 tags y 5 gateways' },
  { name: 'Professional', price: '800 €/año', limits: 'Hasta 20 tags y 10 gateways' },
  { name: 'Enterprise', price: 'A consultar', limits: 'Límites a medida y acompañamiento comercial' }
];

export const hardwarePricing = [
  { name: 'Gateway BLE HorizonST', price: '190 €' },
  { name: 'Antena para Gateway BLE', price: '150 €' },
  { name: 'Tag BLE HorizonST', price: '75 €' },
  { name: 'Fuente PoE', price: '150 €' }
];

export const calculatePotentialSavings = (hoursPerWeek: number, hourlyCost: number, incidentsPerYear: number, incidentCost: number) => {
  const manualControlCost = Math.max(0, hoursPerWeek) * Math.max(0, hourlyCost) * 52;
  const incidentExposure = Math.max(0, incidentsPerYear) * Math.max(0, incidentCost);
  return Math.round((manualControlCost * 0.35) + (incidentExposure * 0.2));
};

function LeadForm({ source, title, cta, defaultInterest }: { source: LeadSource; title: string; cta: string; defaultInterest: string }) {
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
      <label>Empresa<input value={form.companyName} onChange={(event) => update('companyName', event.target.value)} /></label>
      <label>Email profesional<input required type="email" value={form.email} onChange={(event) => update('email', event.target.value)} /></label>
      <label>Teléfono<input value={form.phone} onChange={(event) => update('phone', event.target.value)} /></label>
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
        <a href="#precios">Precios</a>
        <a className="btn secondary" href={customerAccessUrl}>Acceso clientes</a>
      </nav>

      <section id="inicio" className="lp-hero" data-section="hero">
        <p className="eyebrow">Trazabilidad, frío y cumplimiento APPCC</p>
        <h1>Control operativo para empresas que no pueden permitirse perder temperatura, stock ni evidencias.</h1>
        <p>HorizonST combina sensores BLE, gateways y software para digitalizar controles, alertas y registros críticos sin convertir el día a día en una carga administrativa.</p>
        <div className="actions">
          <a className="btn" href="#demo">Solicitar demo</a>
          <a className="btn ghost" href="#calculadora">Calcular ahorro potencial</a>
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

      <section className="lp-section split" data-section="solution">
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

      <section id="appcc" className="lp-section split" data-section="appcc-guide">
        <div>
          <p className="eyebrow">Guía APPCC</p>
          <h2>Descarga una guía práctica para revisar tus controles críticos.</h2>
          <p>Recibe una guía orientativa para identificar puntos de control, evidencias y oportunidades de automatización.</p>
        </div>
        <LeadForm source="appcc_guide" title="Descarga de guía APPCC" cta="Solicitar guía" defaultInterest="Guía APPCC" />
      </section>

      <section id="calculadora" className="lp-section" data-section="savings-calculator">
        <p className="eyebrow">Calculadora</p>
        <h2>Estima el ahorro potencial antes de solicitar una demo.</h2>
        <SavingsCalculator />
      </section>

      <section id="precios" className="lp-section" data-section="plans-pricing">
        <p className="eyebrow">Planes SaaS</p>
        <h2>Precios públicos y límites claros.</h2>
        <div className="lp-grid three">{planPricing.map((plan) => <article className="lp-card" key={plan.name}><h3>{plan.name}</h3><p className="lp-price">{plan.price}</p><p>{plan.limits}</p></article>)}</div>
      </section>

      <section className="lp-section" data-section="hardware-pricing">
        <p className="eyebrow">Hardware</p>
        <h2>Componentes base para desplegar HorizonST.</h2>
        <div className="lp-grid four">{hardwarePricing.map((item) => <article className="lp-card" key={item.name}><h3>{item.name}</h3><p className="lp-price">{item.price}</p></article>)}</div>
      </section>

      <section className="lp-section" data-section="trust">
        <p className="eyebrow">Confianza</p>
        <h2>Diseñado para operaciones B2B que necesitan trazabilidad verificable.</h2>
        <p>Implantación progresiva, acceso privado para clientes y distribuidores, y soporte comercial para dimensionar hardware y licencias.</p>
      </section>

      <section id="demo" className="lp-section split final" data-section="final-cta">
        <div>
          <p className="eyebrow">Siguiente paso</p>
          <h2>Solicita una demo adaptada a tu operación.</h2>
          <p>Cuéntanos tu caso y prepararemos una revisión de necesidades sin presentar resultados garantizados.</p>
        </div>
        <LeadForm source="demo" title="Solicitud de demo" cta="Solicitar demo" defaultInterest="Demo comercial" />
      </section>
    </main>
  );
}
