import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { PublicNav, PublicFooter } from '../components/PublicMarketingShell';
import { CommercialSection } from './CommercialContent';
import { commercialCopy } from '../lib/commercial-copy';
export { PublicNav, PublicFooter, HorneoCase } from '../components/PublicMarketingShell';
export { CommercialHome as PublicHome, CommercialInfo as PublicInfoFaqs } from './CommercialContent';
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
  if (error && plans.length === 0) return null;

  const cards = buildPublicPlanCards(plans);
  if (cards.length === 0) return <p className="lp-note">No hay planes disponibles en este momento. Solicita presupuesto para recibir orientación.</p>;

  return <>
    {error && <p className="lp-note error" role="alert">No se pudieron actualizar los precios. Se muestran los últimos datos cargados como referencia. La acción de prerreserva no está disponible hasta recuperar la consulta; puedes contactar con el equipo comercial.</p>}
    <section className="lp-comparison" aria-labelledby="comparison-title">
      <h2 id="comparison-title">Compara capacidad y cuota</h2>
      <div className="lp-comparison-grid">{cards.map((card) => <div key={card.code} className="lp-comparison-item">
        <h3>{card.name}</h3><p className="lp-price-context">Cuota anual de aplicación</p><p className="lp-price">{card.price}</p>
        <dl>
          <div><dt>Dispositivos personales</dt><dd>{card.maxTags ?? 'Consultar'}</dd></div>
          <div><dt>Puntos de comunicación</dt><dd>{card.maxGateways ?? 'Consultar'}</dd></div></dl>
        {onPrereserve && campaign?.active
          ? <button className="lp-plan-action" type="button" aria-disabled={error || undefined} onClick={(event) => { if (!error) onPrereserve(card.code, event.currentTarget); }}>Prerreservar con 5 % de descuento</button>
          : <a className="btn lp-plan-action" href="/contacto">Consultar condiciones actuales</a>}
      </div>)}</div>
      <div className="lp-service-essential"><p>{annualServiceTerms.included}</p>
        <p>Hardware no incluido. {annualServiceTerms.excluded}</p><p>{annualServiceTerms.renewal}</p>
        <p className="lp-enterprise-note">Enterprise es un plan completo e independiente. No requiere Professional.</p></div>
      <details className="lp-service-details"><summary>Detalle del servicio y condiciones</summary>
        <p>{annualServiceTerms.support}</p><p>{enterpriseTerms}</p>
      </details>
    </section>
    {cards.length < publicPlanCodes.length && <p className="lp-note">Algunas opciones no están disponibles en este momento. Contacta con nosotros para recibir orientación.</p>}
  </>;
}

export const hardwarePacks = [
  { name: 'Starter', coverageSquareMeters: 500, items: ['5 puntos de comunicación inalámbrica', '5 antenas y accesorios de instalación', '1 inyector de alimentación PoE', '10 dispositivos personales inalámbricos con alarma'] },
  { name: 'Professional', coverageSquareMeters: 1000, items: ['10 puntos de comunicación inalámbrica', '10 antenas y accesorios de instalación', '2 inyectores de alimentación PoE', '20 dispositivos personales inalámbricos con alarma'] },
  { name: 'Enterprise', coverageSquareMeters: 2000, items: ['20 puntos de comunicación inalámbrica', '20 antenas y accesorios de instalación', '4 inyectores de alimentación PoE', '40 dispositivos personales inalámbricos con alarma'] }
];

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
  const requestedCode = typeof window === 'undefined' || typeof document === 'undefined' || document.getElementById('root')?.dataset.prerendered === 'true' ? null : new URLSearchParams(window.location.search).get('prerreserva');
  const [selectedCode, setSelectedCode] = useState<PrereservationCode | null>(isPrereservationCode(requestedCode) ? requestedCode : null);
  const [modalTrigger, setModalTrigger] = useState<HTMLButtonElement | null>(null);

  useEffect(() => { const code = new URLSearchParams(window.location.search).get('prerreserva'); if (isPrereservationCode(code)) setSelectedCode(code); }, []);

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
  return <main className="public-landing"><PublicNav /><section className="lp-section lp-plans-page"><p className="eyebrow">Planes</p><h1>Un plan según las necesidades de tu instalación</h1><p>Conoce qué se contrata y consulta la configuración adecuada para tus cámaras y trabajadores.</p><a className="btn" href="/contacto?motivo=presupuesto">Solicitar presupuesto para mi instalación</a><div className="lp-grid three"><article className="lp-card"><h2>Hardware de pago único</h2><p>Adquieres los equipos necesarios para la configuración acordada.</p></article><article className="lp-card"><h2>Software con suscripción anual</h2><p>Contratas el uso de la aplicación mediante una cuota anual según el plan.</p></article><article className="lp-card"><h2>Instalación aparte</h2><p>La instalación se valora y presupuesta por separado según las necesidades del centro.</p></article></div>
    {campaign && <p>{campaign.active ? 'Oferta de prerreserva disponible hasta el' : 'La campaña de prerreserva finalizó el'} {prereservationEndLabel(campaign.endAt)}, incluido. Fecha de referencia: hora peninsular española.</p>}
    <PublicPlanCards plans={plans} loading={loading} error={error} campaign={campaign} onPrereserve={openPrereservation} />
    <h2 className="lp-subheading">Hardware para la instalación</h2><p>Hardware de pago único; aplicación de cuota anual aparte. Estas opciones publicadas requieren un estudio de la instalación: la cobertura es orientativa y no está garantizada. La propuesta concreta la combinación y los servicios adicionales; los nombres de las opciones no vinculan por sí solos un paquete a la capacidad de la aplicación.</p>
    <div className="lp-hardware-options">{hardwarePacks.map((pack) => <details className="lp-hardware-option" key={pack.name}>
      <summary><strong>{pack.name}</strong><span>{coverageLabel(pack.coverageSquareMeters)}</span></summary>
      <div><ul>{pack.items.map((item) => <li key={item}>{item}</li>)}</ul><a className="btn" href={customerAccessUrl()}>Tienda B2B</a></div>
    </details>)}</div>
    <p><a href="/contacto">Consultar la configuración de mi instalación</a></p>
    </section><CommercialSection section={commercialCopy['/planes'].sections[3]} index={30} /><CommercialSection section={commercialCopy['/planes'].sections[4]} index={31} />{selectedCode && <PrereservationAccessModal code={selectedCode} trigger={modalTrigger} onClose={closePrereservation} />}<PublicFooter /></main>;
}
