import { useEffect, useState } from 'react';
import { money } from '../lib/money';
import { prereservationEndLabel, prereservationSessionKey, type PrereservationCode, type PrereservationOffer } from '../lib/prereservation';
import { PublicNav } from './PublicLanding';

type OfferResponse = { campaign: string; endAt: string; offer: PrereservationOffer };

const offerRequest = async (code: PrereservationCode, token: string): Promise<OfferResponse> => {
  const response = await fetch(`/api/public/prereservation/offer?code=${encodeURIComponent(code)}`, {
    headers: { Authorization: `Bearer ${token}` }
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? 'offer_failed');
  return data;
};

export default function PublicPrereservation({ code }: { code: PrereservationCode }) {
  const [data, setData] = useState<OfferResponse | null>(null);
  const [status, setStatus] = useState<'loading' | 'ready' | 'access-required' | 'error' | 'confirming' | 'confirmed' | 'already-confirmed'>('loading');

  useEffect(() => {
    const token = sessionStorage.getItem(prereservationSessionKey(code));
    if (!token) { setStatus('access-required'); return; }
    let active = true;
    offerRequest(code, token)
      .then((offer) => { if (active) { setData(offer); setStatus('ready'); } })
      .catch(() => { if (active) { sessionStorage.removeItem(prereservationSessionKey(code)); setStatus('access-required'); } });
    return () => { active = false; };
  }, [code]);

  const confirm = async () => {
    const token = sessionStorage.getItem(prereservationSessionKey(code));
    if (!token) { setStatus('access-required'); return; }
    setStatus('confirming');
    try {
      const response = await fetch('/api/public/prereservation/confirm', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({ code })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error ?? 'confirmation_failed');
      setStatus(result.alreadyConfirmed ? 'already-confirmed' : 'confirmed');
    } catch { setStatus('error'); }
  };

  if (status === 'loading') return <main className="public-landing"><PublicNav /><section className="lp-section"><p role="status">Cargando oferta...</p></section></main>;
  if (status === 'access-required') return <main className="public-landing"><PublicNav /><section className="lp-section lp-offer"><h1>Acceso a la prerreserva</h1><p>Facilita tu email para consultar la oferta de forma segura.</p><a className="btn" href={`/planes?prerreserva=${code}`}>Continuar</a></section></main>;
  if (!data) return <main className="public-landing"><PublicNav /><section className="lp-section"><p role="alert">No se pudo cargar la oferta.</p></section></main>;

  const { offer } = data;
  return <main className="public-landing"><PublicNav /><section className="lp-section lp-offer"><p className="eyebrow">Prerreserva 2026</p><h1>Oferta {code}</h1><p>Disponible hasta el {prereservationEndLabel(data.endAt)}.</p>
    {!offer.available ? <div className="lp-note"><h2>Configuración personalizada</h2><p>Esta oferta no puede calcularse automáticamente con la configuración actual. Contacta con nuestro equipo comercial.</p><a className="btn" href="mailto:comercial@horizonst.es">Contactar</a></div> : <>
      <div className="lp-offer-lines">
        <div><span>{offer.hardware!.name}</span><strong>{money(offer.hardware!.priceCents)}</strong></div>
        <div><span>Plan Web {offer.webPlan!.name}</span><strong>{money(offer.webPlan!.priceCents)}</strong></div>
        <div><span>Subtotal</span><strong>{money(offer.subtotalCents)}</strong></div>
        <div className="discount"><span>Descuento 5 %</span><strong>-{money(offer.discountCents)}</strong></div>
        <div><span>Subtotal con descuento</span><strong>{money(offer.discountedSubtotalCents)}</strong></div>
        <div><span>IVA</span><strong>{money(offer.taxCents)}</strong></div>
        <div className="total"><span>Total final con IVA</span><strong>{money(offer.totalCents)}</strong></div>
      </div>
      <p>No es una compra y no se realizará ningún cargo. El equipo comercial contactará contigo. El descuento está sujeto a las condiciones de la campaña.</p>
      <button type="button" onClick={confirm} disabled={status === 'confirming' || status === 'confirmed' || status === 'already-confirmed'}>{status === 'confirming' ? 'Confirmando...' : 'Confirmar prerreserva'}</button>
      {status === 'confirmed' && <p className="success">Prerreserva confirmada. Nos pondremos en contacto contigo.</p>}
      {status === 'already-confirmed' && <p className="success">Esta prerreserva ya estaba confirmada.</p>}
      {status === 'error' && <p className="error" role="alert">No se pudo confirmar. Comprueba tu acceso o contacta con nosotros.</p>}
    </>}
  </section></main>;
}
