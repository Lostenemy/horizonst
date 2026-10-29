import React, { FormEvent, useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { canAutoPriceSaasPlan } from '../lib/commercialPricing';
import { customerAccessUrl } from '../lib/domains';
import { money } from '../lib/money';
import { isPrereservationCode, prereservationCodes, prereservationEndLabel, prereservationSessionKey, type PrereservationCampaign, type PrereservationCode } from '../lib/prereservation';
import type { SaasPlan } from '../lib/types';
import { coverageLabel } from '../lib/coverage';
import { annualServiceTerms, enterpriseTerms } from '../components/AnnualServiceTerms';

const publicPlanPresentation: Record<PrereservationCode, { description: string }> = {
  starter: { description: 'Para operaciones que comienzan a digitalizar su supervisión.' },
  professional: { description: 'Para instalaciones que necesitan ampliar su capacidad.' },
  enterprise: { description: 'Para operaciones con mayores necesidades de capacidad.' }
};
const publicPlanCodes = prereservationCodes;

export const publicPlanPrice = (priceCents: number | null) =>
  priceCents == null || priceCents <= 0 ? 'Contactar' : `${money(priceCents)} PVP + IVA / año`;

export const buildPublicPlanCards = (plans: SaasPlan[]) => {
  const plansByCode = new Map(plans.filter((plan) => plan.is_active).map((plan) => [plan.code, plan]));
  return publicPlanCodes.flatMap((code) => {
    const plan = plansByCode.get(code);
    return plan ? [{
      code,
      name: plan.name,
      price: canAutoPriceSaasPlan(plan) ? publicPlanPrice(plan.annual_price_cents) : 'Contactar',
      maxTags: plan.max_tags,
      maxGateways: plan.max_gateways,
      // Compare verified capacity, not arbitrary feature claims in catalog copy.
      description: publicPlanPresentation[code].description
    }] : [];
  });
};

export function PublicPlanCards({ plans, loading, error, campaign, onPrereserve }: { plans: SaasPlan[]; loading: boolean; error: boolean; campaign?: PrereservationCampaign | null; onPrereserve?: (code: PrereservationCode, trigger: HTMLButtonElement) => void }) {
  if (loading) return <p className="lp-note" role="status">Cargando precios de los planes...</p>;
  if (error) return <p className="lp-note error" role="alert">No se pudieron cargar los precios. Solicita presupuesto y te ayudaremos.</p>;

  const cards = buildPublicPlanCards(plans);
  if (cards.length === 0) return <p className="lp-note">No hay planes disponibles en este momento. Solicita presupuesto para recibir orientación.</p>;

  return <>
    <section className="lp-comparison" aria-labelledby="comparison-title">
      <h2 id="comparison-title">Compara capacidad y cuota</h2>
      <p>Cuotas de aplicación y capacidades totales. El hardware se presenta por separado.</p>
      <div className="lp-comparison-grid">{cards.map((card) => <div key={card.code} className="lp-comparison-item">
        <h3>{card.name}</h3><dl><div><dt>Cuota anual de aplicación</dt><dd>{card.price}</dd></div>
          <div><dt>Dispositivos personales</dt><dd>{card.maxTags ?? 'Consultar'}</dd></div>
          <div><dt>Puntos de comunicación</dt><dd>{card.maxGateways ?? 'Consultar'}</dd></div></dl>
      </div>)}</div>
    </section>
    <div className="lp-grid three">{cards.map((card) => <article className="lp-card lp-plan-card" key={card.code}>
      <h2>{card.name}</h2><p className="lp-price">{card.price}</p><p className="lp-price-context">Cuota anual de aplicación. Hardware e instalación no incluidos.</p>
      <p>{card.description}</p><p>Capacidad total: {card.maxTags ?? 'Consultar'} dispositivos personales · {card.maxGateways ?? 'Consultar'} puntos de comunicación.</p>
      {onPrereserve && campaign?.active ? <button type="button" onClick={(event) => onPrereserve(card.code, event.currentTarget)}>Prerreservar con 5 % de descuento</button> : <a className="btn" href="/contacto">Consultar condiciones actuales</a>}
    </article>)}</div>
    <div className="lp-terms"><section><h3>Incluye</h3><p>{annualServiceTerms.included}</p><p>{annualServiceTerms.support}</p></section>
      <section><h3>No incluye</h3><p>{annualServiceTerms.excluded}</p></section></div>
    <p className="lp-note">{annualServiceTerms.renewal}</p><p className="lp-note">{enterpriseTerms}</p>
    {cards.length < publicPlanCodes.length && <p className="lp-note">Algunas opciones no están disponibles en este momento. Contacta con nosotros para recibir orientación.</p>}
  </>;
}

export const hardwarePacks = [
  { name: 'Starter', coverageSquareMeters: 500, items: ['5 puntos de comunicación inalámbrica', '5 antenas y accesorios de instalación', '1 inyector de alimentación PoE', '10 dispositivos personales inalámbricos con alarma'] },
  { name: 'Professional', coverageSquareMeters: 1000, items: ['10 puntos de comunicación inalámbrica', '10 antenas y accesorios de instalación', '2 inyectores de alimentación PoE', '20 dispositivos personales inalámbricos con alarma'] },
  { name: 'Enterprise', coverageSquareMeters: 2000, items: ['20 puntos de comunicación inalámbrica', '20 antenas y accesorios de instalación', '4 inyectores de alimentación PoE', '40 dispositivos personales inalámbricos con alarma'] }
];

export const faqItems = [
  ['¿Cómo funciona HorizonST?', 'Un dispositivo personal se identifica a través de los puntos de comunicación de la instalación.', 'El panel privado organiza accesos, permanencias, alertas e incidencias para el equipo autorizado.'],
  ['¿Cómo se definen los tiempos de permanencia?', 'Los define cada centro; no hay un tiempo universal.', 'Se establecen conforme a su evaluación de riesgos, procedimientos internos y organización del trabajo.'],
  ['¿Qué ocurre cuando se genera una alerta?', 'El equipo responsable comprueba la situación conforme a su procedimiento.', 'HorizonST aporta información de contexto; no sustituye la intervención ni los procedimientos del centro.'],
  ['¿Qué necesita la instalación?', 'Alimentación eléctrica y conexión a Internet.', 'La cobertura y la organización se evalúan antes de implantar. Las superficies orientativas no garantizan cobertura.'],
  ['¿Se necesita realizar obras?', 'Debe evaluarse en cada instalación.', 'No se presupone la necesidad ni la ausencia de obras sin estudiar la cámara y su infraestructura.'],
  ['¿Dónde se consultan los registros?', 'En el panel operativo privado de la instalación.', 'La tienda B2B gestiona catálogo y presupuestos, no los registros de la cámara. Para obtener acceso operativo, consulta al responsable de tu instalación.'],
  ['¿Qué incluye la cuota anual?', 'Uso de la aplicación, actualizaciones y soporte básico de la aplicación.', 'El soporte básico cubre consultas por correo e incidencias de funcionamiento. No incluye instalación, mantenimiento de hardware ni otros servicios. La renovación requiere aceptación previa del cliente.'],
  ['¿El hardware está incluido en la cuota?', 'No. El hardware es de pago único y la aplicación tiene una cuota anual.', 'La propuesta comercial concreta la configuración, los servicios y costes adicionales.'],
  ['¿Necesito Professional antes de Enterprise?', 'No. Enterprise es un plan completo e independiente.', 'Puede contratarse desde cero o como ampliación de un plan existente; sus condiciones se acuerdan en la propuesta comercial.'],
  ['¿Puede adaptarse a varias cámaras o centros?', 'La configuración se estudia según las cámaras y la organización.', 'Consulta los planes y solicita orientación para evaluar las necesidades de tu instalación.']
];

function OperationDiagram() {
  return <figure className="lp-operation-diagram" aria-labelledby="operation-caption">
    <p className="eyebrow">De la detección a la consulta</p>
    <ol><li><span aria-hidden="true">01</span><strong>Accesos</strong><p>Identificación en la instalación</p></li>
      <li><span aria-hidden="true">02</span><strong>Permanencias</strong><p>Seguimiento y alertas</p></li>
      <li><span aria-hidden="true">03</span><strong>Historial</strong><p>Revisión por el equipo autorizado</p></li></ol>
    <figcaption id="operation-caption">Esquema conceptual. No representa hardware ni una instalación real.</figcaption>
  </figure>;
}

export function PublicNav() {
  const pathname = typeof window === 'undefined' ? '/' : window.location.pathname;
  return <nav className="lp-nav" aria-label="Navegación pública">
    <a className="lp-brand" href="/">HorizonST</a>
    <div className="lp-nav-links">{[['/', 'Inicio'], ['/planes', 'Planes'], ['/info-faqs', 'Cómo funciona'], ['/contacto', 'Contacto']].map(([href, label]) =>
      <a key={href} href={href} aria-current={pathname === href ? 'page' : undefined}>{label}</a>)}</div>
    <a className="btn secondary" href={customerAccessUrl()}>Tienda B2B</a>
  </nav>;
}

export function PublicFooter() {
  return <footer className="lp-footer"><p>HorizonST · Supervisión operativa para cámaras congeladoras</p><nav aria-label="Legal"><a href="/contacto">Contacto</a><a href="/aviso-legal">Aviso legal</a><a href="/privacidad">Privacidad</a></nav></footer>;
}

function GuideForm() {
  const [email, setEmail] = useState(''); const [privacyAccepted, setPrivacyAccepted] = useState(false); const [website, setWebsite] = useState(''); const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const submit = async (event: FormEvent) => { event.preventDefault(); setStatus('sending'); try { const response = await fetch('/api/leads', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ source: 'appcc_guide', email, privacyAccepted, website }) }); if (!response.ok) throw new Error('guide_failed'); setStatus('sent'); setEmail(''); setPrivacyAccepted(false); setWebsite(''); } catch { setStatus('error'); } };
  return <form id="guia-solicitud" className="lp-form" onSubmit={submit} data-lead-source="appcc_guide" aria-labelledby="guide-request-title">
    <p className="eyebrow">Recurso gratuito</p><h2 id="guide-request-title">Guía 2026 para la seguridad en cámaras congeladoras</h2><p>Un documento práctico sobre accesos, permanencias, alertas e incidencias.</p>
    <label>Email profesional<input required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
    <label className="lp-honeypot" aria-hidden="true">Web<input tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} /></label>
    <label className="lp-privacy"><input required type="checkbox" checked={privacyAccepted} onChange={(event) => setPrivacyAccepted(event.target.checked)} /><span>He leído y acepto la <a href="/privacidad">política de privacidad</a>.</span></label>
    <button type="submit" disabled={status === 'sending'}>{status === 'sending' ? 'Enviando...' : 'Recibir la guía por email'}</button>
    {status === 'sent' && <p className="success" role="status" aria-live="polite">Revisa tu correo para acceder a la guía.</p>}{status === 'error' && <p className="error" role="alert">No se pudo enviar la guía. Inténtalo de nuevo más tarde.</p>}
  </form>;
}

// Optional slot for future reviewed material; no testimonial/video or placeholder ships.
export function HorneoCase({ approvedMedia }: { approvedMedia?: React.ReactNode } = {}) {
  return <section className="lp-section lp-success-case" aria-labelledby="horneo-case-title">
    <div><p className="eyebrow">Implantación</p><h2 id="horneo-case-title">Horneo: un caso real</h2>
      <p>Horneo ya utiliza HorizonST en una cámara frigorífica de aproximadamente 400 m² para supervisar la actividad de 10 trabajadores distintos.</p>
      <p className="lp-note-copy">Este caso describe una instalación, no un resultado medido ni una garantía de seguridad. Los procedimientos de trabajo y respuesta corresponden al centro.</p></div>
    <img src="/images/casos-exito/horneo.png" alt="Logotipo de Horneo" width="320" height="320" loading="lazy" decoding="async" />
    {approvedMedia && <div className="lp-case-media">{approvedMedia}</div>}
  </section>;
}

export function PublicHome() {
  return <main className="public-landing"><PublicNav />
    <section className="lp-hero lp-revised-hero"><div className="lp-hero-copy"><p className="eyebrow">Supervisión en frío extremo</p>
      <h1>Supervisa accesos y permanencias en tus cámaras congeladoras.</h1>
      <ul className="lp-hero-points"><li>Controla los tiempos de permanencia.</li><li>Recibe alertas para comprobar la situación.</li><li>Consulta el historial de actividad e incidencias.</li></ul>
      <div className="actions"><a className="btn" href="/contacto">Consultar mi instalación</a><a className="btn ghost" href="/info-faqs#funcionamiento">Ver cómo funciona</a></div>
      <a className="lp-guide-link" href="#guia-solicitud">Recurso complementario: guía gratuita</a></div><OperationDiagram />
    </section>
    <HorneoCase />
    <section className="lp-section" aria-labelledby="home-process-title"><p className="eyebrow">Cómo se organiza</p><h2 id="home-process-title">Detecciones, seguimiento y consulta.</h2>
      <div className="lp-grid three"><article className="lp-card"><h3>Identifica la actividad</h3><p>Dispositivos personales y puntos de comunicación mediante tecnologías inalámbricas.</p></article>
        <article className="lp-card"><h3>Comprueba las alertas</h3><p>El equipo responsable dispone de contexto para aplicar su procedimiento interno.</p></article>
        <article className="lp-card"><h3>Revisa el historial</h3><p>Consulta sesiones e incidencias desde el panel privado de la instalación.</p></article></div>
      <p className="lp-note-copy">Los tiempos, la intervención y los procedimientos los define cada centro. HorizonST no sustituye esa responsabilidad.</p>
    </section>
    <section className="lp-section lp-use-cases" aria-labelledby="sectors-title"><div><p className="eyebrow">Dónde se utiliza</p><h2 id="sectors-title">En operaciones con cámaras de frío.</h2>
      <p>La configuración se estudia según las cámaras, los trabajadores y la organización del centro.</p></div>
      <ul><li>Cámaras frigoríficas</li><li>Almacenes de producto congelado</li><li>Procesos de alimentación y almacenamiento especializado</li></ul>
      <a className="btn secondary" href="/planes">Ver planes</a>
    </section>
    <section id="guia" className="lp-section lp-compact-guide" aria-labelledby="guide-request-title"><GuideForm /></section>
    <section className="lp-section lp-final-cta"><h2>Estudiemos tu instalación.</h2><p>Cuéntanos cómo son tus cámaras y cómo trabaja tu equipo.</p><a className="btn" href="/contacto">Consultar mi instalación</a></section>
    <PublicFooter /></main>;
}

function PrereservationAccessModal({ code, trigger, onClose }: { code: PrereservationCode; trigger: HTMLButtonElement | null; onClose: () => void }) {
  const [email, setEmail] = useState('');
  const [privacyAccepted, setPrivacyAccepted] = useState(false);
  const [website, setWebsite] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'error' | 'expired'>('idle');
  const emailRef = useRef<HTMLInputElement>(null);
  const modalRef = useRef<HTMLElement>(null);

  useEffect(() => {
    emailRef.current?.focus();
    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { onClose(); return; }
      if (event.key !== 'Tab') return;
      const focusable = [...(modalRef.current?.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), a[href]') ?? [])];
      if (focusable.length === 0) return;
      const first = focusable[0]; const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', handleKeyboard);
    return () => { document.removeEventListener('keydown', handleKeyboard); trigger?.focus(); };
  }, [onClose, trigger]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (status === 'sending') return;
    setStatus('sending');
    try {
      const response = await fetch('/api/public/prereservation/access', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim().toLowerCase(), code, privacyAccepted, website })
      });
      const data = await response.json().catch(() => ({}));
      if (response.status === 410) { setStatus('expired'); return; }
      if (!response.ok || typeof data.accessToken !== 'string' || data.code !== code) throw new Error('access_failed');
      sessionStorage.setItem(prereservationSessionKey(code), data.accessToken);
      window.location.assign(`/prerreserva/${code}`);
    } catch { setStatus('error'); }
  };

  return <div className="lp-modal-backdrop"><section ref={modalRef} className="lp-modal" role="dialog" aria-modal="true" aria-labelledby="prereservation-modal-title">
    <button className="lp-modal-close" type="button" aria-label="Cerrar" onClick={onClose}>×</button>
    <p className="eyebrow">Prerreserva {code}</p><h2 id="prereservation-modal-title">Accede a la oferta de prerreserva</h2>
    <p>La campaña ofrece un 5 % de descuento hasta el 1 de enero de 2027 inclusive (Europe/Madrid). Valida tu correo para consultar la oferta correspondiente al plan seleccionado; allí verás su desglose.</p>
    <form className="lp-form" onSubmit={submit}>
      <label>Email profesional<input ref={emailRef} required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label className="lp-honeypot" aria-hidden="true">Web<input tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} /></label>
      <label className="lp-privacy"><input required type="checkbox" checked={privacyAccepted} onChange={(event) => setPrivacyAccepted(event.target.checked)} /><span>He leído y acepto la <a href="/privacidad">política de privacidad</a>.</span></label>
      <button type="submit" disabled={status === 'sending'}>{status === 'sending' ? 'Validando...' : 'Ver oferta'}</button>
      {status === 'error' && <p className="error" role="alert">No se pudo autorizar el acceso. Revisa el email e inténtalo de nuevo.</p>}
      {status === 'expired' && <p className="error" role="alert">La campaña de prerreserva ha finalizado. <a href="/contacto">Consultar condiciones actuales</a></p>}
    </form>
  </section></div>;
}

export function PublicPlans() {
  const [plans, setPlans] = useState<SaasPlan[]>([]);
  const [campaign, setCampaign] = useState<PrereservationCampaign | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const requestedCode = new URLSearchParams(window.location.search).get('prerreserva');
  const [selectedCode, setSelectedCode] = useState<PrereservationCode | null>(isPrereservationCode(requestedCode) ? requestedCode : null);
  const [modalTrigger, setModalTrigger] = useState<HTMLButtonElement | null>(null);

  useEffect(() => {
    let active = true;
    const load = () => Promise.all([
      api<{ saasPlans: SaasPlan[] }>('/api/catalog/saas-plans'),
      api<PrereservationCampaign>('/api/public/prereservation/campaign')
    ])
      .then(([data, campaignData]) => { if (active) { setPlans(data.saasPlans); setCampaign(campaignData); setError(false); } })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    load();
    const timer = window.setInterval(load, 30000);
    return () => { active = false; window.clearInterval(timer); };
  }, []);

  const openPrereservation = (code: PrereservationCode, trigger: HTMLButtonElement) => { setModalTrigger(trigger); setSelectedCode(code); };
  const closePrereservation = useCallback(() => setSelectedCode(null), []);
  return <main className="public-landing"><PublicNav /><section className="lp-section lp-plans-page"><p className="eyebrow">Planes</p><h1>Planes de la aplicación HorizonST</h1>
    {campaign && <p>{campaign.active ? 'Oferta de prerreserva disponible hasta el' : 'La campaña de prerreserva finalizó el'} {prereservationEndLabel(campaign.endAt)} (inclusive, Europe/Madrid).</p>}
    <PublicPlanCards plans={plans} loading={loading} error={error} campaign={campaign} onPrereserve={openPrereservation} />
    <h2 className="lp-subheading">Hardware para la instalación</h2><p>La aplicación y el hardware son conceptos distintos. Estas son las opciones publicadas de hardware; la propuesta concreta la combinación adecuada y los servicios adicionales. Las superficies son orientativas, no una garantía de cobertura.</p>
    <div className="lp-grid three">{hardwarePacks.map((pack) => <article className="lp-card lp-plan-card" key={pack.name}><h2>{pack.name}</h2><p><strong>{coverageLabel(pack.coverageSquareMeters)}</strong></p><ul>{pack.items.map((item) => <li key={item}>{item}</li>)}</ul><p>Hardware de pago único. Precio y condiciones en la tienda B2B; aplicación de cuota anual aparte.</p><a className="btn" href={customerAccessUrl()}>Tienda B2B</a></article>)}</div>
    <p><a href="/contacto">Consultar la configuración de mi instalación</a></p>
    </section>{selectedCode && <PrereservationAccessModal code={selectedCode} trigger={modalTrigger} onClose={closePrereservation} />}<PublicFooter /></main>;
}

export function PublicInfoFaqs() { return <main className="public-landing"><PublicNav /><section className="lp-info-hero"><p className="eyebrow">Funcionamiento y preguntas frecuentes</p><h1>Cómo funciona HorizonST</h1><p>De la detección en la cámara a la consulta del historial operativo.</p></section>
  <section id="funcionamiento" className="lp-section"><h2>Un proceso claro, de la entrada al registro.</h2><ol className="lp-steps"><li><strong>Dispositivo personal.</strong><span>El trabajador lleva un dispositivo inalámbrico identificado en la instalación.</span></li><li><strong>Puntos de comunicación.</strong><span>La infraestructura de la cámara recoge detecciones y permite supervisar permanencias.</span></li><li><strong>Aviso al responsable.</strong><span>Las alertas aportan contexto al equipo autorizado para aplicar su procedimiento.</span></li><li><strong>Consulta del historial.</strong><span>El panel operativo organiza sesiones e incidencias para su revisión posterior.</span></li></ol><p>La instalación requiere alimentación eléctrica y conexión a Internet. La cobertura y la organización del centro se evalúan antes de implantar. Las dimensiones orientativas no garantizan cobertura; los tiempos y la respuesta los define cada operación.</p></section>
  <section className="lp-section"><p className="eyebrow">Qué aporta</p><h2>Información para aplicar tu procedimiento.</h2><div className="lp-grid three"><article className="lp-card"><h3>Tiempos de permanencia</h3><p>Una referencia operativa para revisar la actividad en las cámaras.</p></article><article className="lp-card"><h3>Alertas con contexto</h3><p>Información para comprobar la situación y coordinar la respuesta del centro.</p></article><article className="lp-card"><h3>Actividad e incidencias</h3><p>Un historial organizado para la revisión posterior por el equipo autorizado.</p></article></div></section>
  <section className="lp-section lp-faq"><p className="eyebrow">FAQ</p><h2>Preguntas frecuentes</h2><div>{faqItems.map(([question, answer, detail]) => <details key={question}><summary>{question}</summary><p>{answer}</p><p>{detail}</p></details>)}</div></section>
  <section className="lp-section lp-final-cta"><p>¿Quieres conocer la solución adecuada para tu operación?</p><h2>Consulta tu instalación con nuestro equipo.</h2><div className="actions"><a className="btn" href="/contacto">Solicitar orientación</a><a className="btn ghost" href="/planes">Ver planes</a><a className="btn ghost" href={customerAccessUrl()}>Tienda B2B</a></div></section><PublicFooter /></main>; }
