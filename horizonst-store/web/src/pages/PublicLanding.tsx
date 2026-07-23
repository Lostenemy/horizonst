import React, { FormEvent, useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { canAutoPriceSaasPlan } from '../lib/commercialPricing';
import { customerAccessUrl } from '../lib/domains';
import { money } from '../lib/money';
import { isPrereservationCode, prereservationCodes, prereservationEndLabel, prereservationSessionKey, type PrereservationCampaign, type PrereservationCode } from '../lib/prereservation';
import type { SaasPlan } from '../lib/types';
import { coverageLabel } from '../lib/coverage';

const publicPlanPresentation: Record<PrereservationCode, { description: string }> = {
  starter: { description: 'Para operaciones que comienzan a digitalizar su supervisión.' },
  professional: { description: 'Para equipos que necesitan ampliar cobertura y trazabilidad.' },
  enterprise: { description: 'Para operaciones con mayor capacidad y configuración comercial avanzada.' }
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
      name: `Plan ${plan.name}`,
      price: canAutoPriceSaasPlan(plan) ? publicPlanPrice(plan.annual_price_cents) : 'Contactar',
      description: plan.description ?? publicPlanPresentation[code].description
    }] : [];
  });
};

export function PublicPlanCards({ plans, loading, error, campaign, onPrereserve }: { plans: SaasPlan[]; loading: boolean; error: boolean; campaign?: PrereservationCampaign | null; onPrereserve?: (code: PrereservationCode, trigger: HTMLButtonElement) => void }) {
  if (loading) return <p className="lp-note" role="status">Cargando precios de los planes...</p>;
  if (error) return <p className="lp-note error" role="alert">No se pudieron cargar los precios. Solicita presupuesto y te ayudaremos.</p>;

  const cards = buildPublicPlanCards(plans);
  if (cards.length === 0) return <p className="lp-note">No hay planes disponibles en este momento. Solicita presupuesto para recibir orientación.</p>;

  return <><div className="lp-grid three">{cards.map((card) => <article className="lp-card" key={card.code}><h2>{card.name}</h2><p className="lp-price">{card.price}</p><p>{card.description}</p>{onPrereserve && campaign && <button type="button" disabled={!campaign.active} onClick={(event) => onPrereserve(card.code, event.currentTarget)}>{campaign.active ? 'Prerreservar con 5 % de descuento' : 'Campaña finalizada'}</button>}</article>)}</div>{cards.length < publicPlanCodes.length && <p className="lp-note">Algunas opciones no están disponibles en este momento. Contacta con nosotros para recibir orientación.</p>}</>;
}

export const hardwarePacks = [
  { name: 'Pack Starter', coverageSquareMeters: 500, items: ['5 puntos de comunicación inalámbrica', '5 antenas y accesorios de instalación', '1 inyector de alimentación PoE', '10 dispositivos personales inalámbricos con alarma'] },
  { name: 'Pack Professional', coverageSquareMeters: 1000, items: ['10 puntos de comunicación inalámbrica', '10 antenas y accesorios de instalación', '2 inyectores de alimentación PoE', '20 dispositivos personales inalámbricos con alarma'] },
  { name: 'Pack Enterprise', coverageSquareMeters: 2000, items: ['20 puntos de comunicación inalámbrica', '20 antenas y accesorios de instalación', '4 inyectores de alimentación PoE', '40 dispositivos personales inalámbricos con alarma'] }
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

export const campaignComicPanels = [
  { src: '/images/campaign-comic/05-entering-freezer.webp', width: 1400, height: 788, alt: 'Trabajador equipado entrando en una gran cámara congeladora', caption: 'La jornada comienza con un acceso identificado a la zona de frío.' },
  { src: '/images/campaign-comic/06-buddy-check.webp', width: 1400, height: 933, alt: 'Dos trabajadoras comprueban sus dispositivos personales antes de entrar', caption: 'El equipo comprueba que cada dispositivo está preparado antes de acceder.' },
  { src: '/images/campaign-comic/09-frozen-bakery.webp', width: 1122, height: 1402, alt: 'Trabajador supervisando producto en una cámara congeladora de panadería', caption: 'La supervisión acompaña el trabajo diario sin alterar la operativa.' },
  { src: '/images/campaign-comic/10-seafood-cold-chain.webp', width: 1122, height: 1402, alt: 'Trabajadora de la cadena de frío manipulando una caja de pescado', caption: 'La misma trazabilidad se adapta a distintos entornos de la cadena de frío.' },
  { src: '/images/campaign-comic/11-pharma-cold-room.webp', width: 1400, height: 933, alt: 'Trabajador verificando su dispositivo a la entrada de una cámara farmacéutica', caption: 'Cada acceso aporta contexto sobre quién entra y cuándo lo hace.' },
  { src: '/images/campaign-comic/12-produce-freezer.webp', width: 1400, height: 788, alt: 'Trabajador recorriendo un almacén refrigerado de frutas y verduras', caption: 'La cobertura mantiene visible la actividad incluso en instalaciones amplias.' },
  { src: '/images/campaign-comic/19-mobile-alert.webp', width: 1122, height: 1402, alt: 'Responsable recibiendo una alerta en el móvil junto a una cámara frigorífica', caption: 'Si ocurre una situación prevista, el equipo responsable recibe el aviso.' },
  { src: '/images/campaign-comic/08-alert-response.webp', width: 1400, height: 933, alt: 'Equipo de respuesta accediendo a una cámara frigorífica con la alarma activada', caption: 'La alerta pone en marcha el procedimiento interno de comprobación.' },
  { src: '/images/campaign-comic/17-controlled-exit.webp', width: 1400, height: 933, alt: 'Trabajador saliendo de una cámara de frío y consultando su dispositivo', caption: 'La salida queda controlada para cerrar el ciclo con mayor seguridad.' },
  { src: '/images/campaign-comic/15-incident-review.webp', width: 1400, height: 758, alt: 'Dos responsables revisando registros de una incidencia en un portátil', caption: 'Después, el historial permite reconstruir lo ocurrido y mejorar el procedimiento.' },
  { src: '/images/campaign-comic/14-team-onboarding.webp', width: 1400, height: 788, alt: 'Equipo recibiendo formación sobre el uso de HorizonST', caption: 'La formación integra la solución en los hábitos de todo el equipo.' },
  { src: '/images/campaign-comic/18-charging-fleet.webp', width: 1400, height: 788, alt: 'Conjunto de dispositivos personales cargando antes de una jornada', caption: 'Los dispositivos quedan organizados y listos para el siguiente turno.' },
  { src: '/images/campaign-comic/20-worker-portrait.webp', width: 1122, height: 1402, alt: 'Trabajador protegido frente al frío con un dispositivo personal iluminado', caption: 'HorizonST ayuda a cuidar a las personas que trabajan en frío extremo.' }
] as const;

function CampaignComic() {
  return <section className="lp-section lp-comic" aria-labelledby="campaign-comic-title">
    <div className="lp-comic-intro"><p className="eyebrow">HorizonST en acción</p><h2 id="campaign-comic-title">Una jornada en frío, viñeta a viñeta.</h2><p>Del acceso a la respuesta ante una alerta, descubre cómo HorizonST aporta visibilidad y trazabilidad a la operativa diaria.</p></div>
    <ol className="lp-comic-sequence">{campaignComicPanels.map((panel) => <li key={panel.src} className={panel.height > panel.width ? 'portrait' : undefined}><figure><img src={panel.src} alt={panel.alt} width={panel.width} height={panel.height} loading="lazy" decoding="async" sizes={panel.height > panel.width ? '(max-width: 720px) 100vw, 620px' : '(max-width: 720px) 100vw, 980px'} /><figcaption>{panel.caption}</figcaption></figure></li>)}</ol>
    <div className="lp-comic-cta"><p>Conoce el proceso, las alertas y la información que tendrás a tu alcance.</p><a className="btn" href="/info-faqs">Descubrir cómo funciona</a></div>
  </section>;
}

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

export function PublicHome() {
  return <main className="public-landing"><PublicNav /><section className="lp-hero"><p className="eyebrow">Seguridad en frío extremo</p><h1>Supervisa mejor a quienes trabajan en cámaras congeladoras.</h1><p>Controla permanencias, recibe alertas y conserva un historial operativo para actuar con mayor rapidez.</p><div className="actions"><a className="btn" href="#guia">Recibir la guía</a><a className="btn ghost" href="/info-faqs">Cómo funciona</a></div></section>
    <section className="lp-section lp-intro"><p className="eyebrow">Una operación más preparada</p><h2>Visibilidad cuando más importa.</h2><p>HorizonST ayuda a organizar el control de accesos y tiempos de permanencia mediante tecnologías inalámbricas, con alertas y trazabilidad pensadas para el equipo responsable.</p></section>
    <CampaignComic />
    <section className="lp-section lp-success-case" aria-labelledby="horneo-case-title"><div><p className="eyebrow">Caso de éxito</p><h2 id="horneo-case-title">Horneo</h2><p>Horneo ya utiliza HorizonST en una cámara frigorífica de aproximadamente 400 m², donde el sistema ayuda a supervisar la actividad de 10 trabajadores distintos y aporta una visión más clara y centralizada de la operativa diaria.</p></div><img src="/images/casos-exito/horneo.png" alt="Logotipo de Horneo" width="320" height="320" loading="lazy" /></section>
    <section id="guia" className="lp-section"><GuideForm /></section>
    <section className="lp-section lp-plans-cta"><p>¿Quieres conocer las soluciones disponibles?</p><h2>Consulta los planes de HorizonST.</h2><a className="btn" href="/planes">Ver planes</a></section><PublicFooter /></main>;
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
    <form className="lp-form" onSubmit={submit}>
      <label>Email profesional<input ref={emailRef} required type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} /></label>
      <label className="lp-honeypot" aria-hidden="true">Web<input tabIndex={-1} autoComplete="off" value={website} onChange={(event) => setWebsite(event.target.value)} /></label>
      <label className="lp-privacy"><input required type="checkbox" checked={privacyAccepted} onChange={(event) => setPrivacyAccepted(event.target.checked)} /> He leído y acepto la <a href="/privacidad">política de privacidad</a>.</label>
      <button type="submit" disabled={status === 'sending'}>{status === 'sending' ? 'Validando...' : 'Ver oferta'}</button>
      {status === 'error' && <p className="error" role="alert">No se pudo autorizar el acceso. Revisa el email e inténtalo de nuevo.</p>}
      {status === 'expired' && <p className="error" role="alert">La campaña de prerreserva ha finalizado.</p>}
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
    Promise.all([
      api<{ saasPlans: SaasPlan[] }>('/api/catalog/saas-plans'),
      api<PrereservationCampaign>('/api/public/prereservation/campaign')
    ])
      .then(([data, campaignData]) => { if (active) { setPlans(data.saasPlans); setCampaign(campaignData); } })
      .catch(() => { if (active) setError(true); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);

  const openPrereservation = (code: PrereservationCode, trigger: HTMLButtonElement) => { setModalTrigger(trigger); setSelectedCode(code); };
  return <main className="public-landing"><PublicNav /><section className="lp-section"><p className="eyebrow">Planes</p><h1>Planes de servicios Web</h1>{campaign && <p>Oferta de prerreserva disponible hasta el {prereservationEndLabel(campaign.endAt)}.</p>}<PublicPlanCards plans={plans} loading={loading} error={error} campaign={campaign} onPrereserve={openPrereservation} /><h2 className="lp-subheading">Planes de hardware</h2><div className="lp-grid three">{hardwarePacks.map((pack) => <article className="lp-card" key={pack.name}><h2>{pack.name}</h2><p><strong>{coverageLabel(pack.coverageSquareMeters)}</strong></p><ul>{pack.items.map((item) => <li key={item}>{item}</li>)}</ul><p>El precio y las condiciones comerciales están disponibles en la zona registrada.</p><a className="btn" href={customerAccessUrl}>Acceso clientes</a></article>)}</div></section>{selectedCode && <PrereservationAccessModal code={selectedCode} trigger={modalTrigger} onClose={() => setSelectedCode(null)} />}<PublicFooter /></main>;
}

export function PublicInfoFaqs() { return <main className="public-landing"><PublicNav /><section className="lp-info-hero"><p className="eyebrow">Información y preguntas frecuentes</p><h1>Todo lo que necesitas saber sobre HorizonST</h1><p>Consulta cómo funciona la solución, qué problemas ayuda a resolver y las respuestas a las dudas más habituales.</p></section>
  <section className="lp-section"><p className="eyebrow">El problema</p><h2>Situaciones que necesitan más visibilidad.</h2><div className="lp-grid three"><article className="lp-card lp-icon-card"><span>01</span><h3>Permanencias sin controlar</h3><p>Sin una referencia operativa clara, detectar una permanencia prolongada depende de revisiones manuales.</p></article><article className="lp-card lp-icon-card"><span>02</span><h3>Alarmas tardías</h3><p>Una señal sin aviso estructurado puede retrasar la comprobación y la intervención necesaria.</p></article><article className="lp-card lp-icon-card"><span>03</span><h3>Registros dispersos</h3><p>La información repartida dificulta reconstruir una incidencia y mejorar el procedimiento.</p></article></div></section>
  <section className="lp-section"><p className="eyebrow">Beneficios</p><h2>Información útil para reaccionar mejor.</h2><div className="lp-grid four"><article className="lp-card"><h3>Mayor capacidad de reacción</h3><p>Avisos para que el equipo responsable pueda comprobar la situación.</p></article><article className="lp-card"><h3>Control de tiempos</h3><p>Supervisión de permanencias según los umbrales internos definidos.</p></article><article className="lp-card"><h3>Trazabilidad operativa</h3><p>Contexto para revisar accesos, alertas e incidencias.</p></article><article className="lp-card"><h3>Historial centralizado</h3><p>Consulta organizada desde un acceso privado.</p></article></div></section>
  <section className="lp-section"><p className="eyebrow">Cómo funciona</p><h2>Un proceso claro, de la entrada al registro.</h2><ol className="lp-steps"><li><strong>El trabajador accede.</strong><span>El acceso queda identificado en la operación.</span></li><li><strong>El sistema supervisa.</strong><span>Se controla la permanencia conforme a los criterios internos.</span></li><li><strong>Se generan alertas.</strong><span>El equipo responsable recibe el aviso cuando corresponde.</span></li><li><strong>La incidencia queda registrada.</strong><span>El historial facilita la revisión posterior.</span></li></ol></section>
  <section className="lp-section lp-faq"><p className="eyebrow">FAQ</p><h2>Preguntas frecuentes</h2><div>{faqItems.map(([question, answer]) => <details key={question}><summary>{question}</summary><p>{answer}</p></details>)}</div></section>
  <section className="lp-section lp-final-cta"><p>¿Quieres conocer la solución adecuada para tu operación?</p><h2>Consulta los planes o accede a la zona de clientes.</h2><div className="actions"><a className="btn" href="/planes">Ver planes</a><a className="btn ghost" href={customerAccessUrl}>Acceso clientes</a></div></section><PublicFooter /></main>; }
