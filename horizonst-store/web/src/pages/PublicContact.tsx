import { FormEvent, useRef, useState } from 'react';
import { PublicFooter, PublicNav } from './PublicLanding';

export default function PublicContact() {
  const [fullName, setName] = useState('');
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [privacyAccepted, setPrivacy] = useState(false);
  const [website, setWebsite] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle');
  const inFlight = useRef(false);
  const form = useRef<HTMLFormElement>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (inFlight.current || status === 'sent') return;
    const invalid: Record<string, string> = {};
    if (fullName.trim().length < 2) invalid.fullName = 'Introduce tu nombre (al menos 2 caracteres).';
    if (!form.current?.querySelector<HTMLInputElement>('#contact-email')?.validity.valid || !email.trim()) invalid.email = 'Introduce un correo electrónico válido.';
    if (message.trim().length < 10) invalid.message = 'Escribe un mensaje de al menos 10 caracteres.';
    if (!privacyAccepted) invalid.privacyAccepted = 'Debes aceptar la política de privacidad.';
    setErrors(invalid);
    if (Object.keys(invalid).length) { form.current?.querySelector<HTMLElement>(`[name="${Object.keys(invalid)[0]}"]`)?.focus(); return; }
    inFlight.current = true; setStatus('sending');
    try {
      const response = await fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ fullName, email, message, privacyAccepted, website }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok !== true) throw new Error('contact_unavailable');
      setStatus('sent'); setName(''); setEmail(''); setMessage(''); setPrivacy(false);
    } catch { setStatus('error'); } finally { inFlight.current = false; }
  };
  return <main className="public-landing"><PublicNav /><section className="lp-section public-contact"><h1>Contacto</h1><p>Cuéntanos qué necesitas. Nuestro equipo comercial responderá a tu correo.</p>
    <form ref={form} className="lp-form" noValidate onSubmit={submit} aria-busy={status === 'sending'}>
      <label htmlFor="contact-name">Nombre</label><input id="contact-name" name="fullName" required minLength={2} maxLength={200} autoComplete="name" value={fullName} disabled={status === 'sending'} onChange={(e) => setName(e.target.value)} aria-invalid={!!errors.fullName} aria-describedby="contact-name-help" />
      <small id="contact-name-help">{errors.fullName ?? 'Entre 2 y 200 caracteres.'}</small>
      <label htmlFor="contact-email">Correo electrónico</label><input id="contact-email" name="email" type="email" required maxLength={320} autoComplete="email" value={email} disabled={status === 'sending'} onChange={(e) => setEmail(e.target.value)} aria-invalid={!!errors.email} aria-describedby="contact-email-help" />
      <small id="contact-email-help">{errors.email ?? 'Lo utilizaremos para responderte.'}</small>
      <label htmlFor="contact-message">Mensaje</label><textarea id="contact-message" name="message" required minLength={10} maxLength={2000} rows={6} value={message} disabled={status === 'sending'} onChange={(e) => setMessage(e.target.value)} aria-invalid={!!errors.message} aria-describedby="contact-message-help" />
      <small id="contact-message-help">{errors.message ?? 'Entre 10 y 2000 caracteres.'}</small>
      <label className="lp-honeypot" aria-hidden="true">Web<input tabIndex={-1} autoComplete="off" value={website} onChange={(e) => setWebsite(e.target.value)} /></label>
      <label className="lp-privacy" htmlFor="contact-privacy"><input id="contact-privacy" name="privacyAccepted" type="checkbox" required checked={privacyAccepted} disabled={status === 'sending'} onChange={(e) => setPrivacy(e.target.checked)} aria-invalid={!!errors.privacyAccepted} aria-describedby="contact-privacy-help" /> He leído y acepto la <a href="/privacidad">política de privacidad</a>.</label>
      <small id="contact-privacy-help">{errors.privacyAccepted}</small>
      {Object.keys(errors).length > 0 && <p role="alert">Revisa los campos indicados antes de enviar.</p>}
      <button type="submit" disabled={status === 'sending' || status === 'sent'}>{status === 'sending' ? 'Enviando...' : 'Enviar mensaje'}</button>
      {status === 'sending' && <p role="status">Enviando tu mensaje...</p>}
      {status === 'sent' && <p role="status">Mensaje enviado. Nuestro equipo comercial te responderá por correo.</p>}
      {status === 'error' && <p role="alert">No se ha podido confirmar el envío. Tus datos se conservan. Inténtalo más tarde; evita repetir el mismo mensaje mientras se comprueba su entrega.</p>}
    </form></section><PublicFooter /></main>;
}
