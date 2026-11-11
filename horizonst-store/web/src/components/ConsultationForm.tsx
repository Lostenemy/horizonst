import { useEffect, useRef, useState, type FormEvent } from 'react';
import { collaborationProfiles, consultationPurposes, customerProfiles, type ConsultationProfile, type ConsultationPurpose } from '../../../src/resources/contact-context';
export const profileLabels: Record<ConsultationProfile, string> = {
  empresa: 'Empresa', gerencia: 'Gerencia', operaciones: 'Operaciones', prl: 'PRL', calidad: 'Calidad', 'recursos-humanos': 'Recursos Humanos', mantenimiento: 'Mantenimiento', finanzas: 'Finanzas', otro: 'Otro',
  instaladores: 'Instaladores de cámaras congeladoras', 'asesorias-prl': 'Asesorías de PRL', 'ingenierias-frio': 'Ingenierías de frío'
};
export const purposeLabels: Record<ConsultationPurpose, string> = { instalacion: 'Consultar mi instalación', presupuesto: 'Solicitar presupuesto para mi instalación', colaboracion: 'Solicitar información de colaboración' };
export function consultationPurpose(search: string): ConsultationPurpose | '' {
  const value = new URLSearchParams(search).get('motivo');
  return consultationPurposes.includes(value as ConsultationPurpose) ? value as ConsultationPurpose : '';
}
export default function ConsultationForm({ initialPurpose = '', fixedProfile, onPurposeChange }: { initialPurpose?: ConsultationPurpose | ''; fixedProfile?: ConsultationProfile; onPurposeChange?: (value: ConsultationPurpose | '') => void }) {
  const [purpose, setPurpose] = useState<ConsultationPurpose | ''>(initialPurpose);
  useEffect(() => { setPurpose(initialPurpose); }, [initialPurpose]);
  const [profile, setProfile] = useState<ConsultationProfile | ''>(fixedProfile ?? '');
  const [values, setValues] = useState({ fullName: '', companyName: '', email: '', message: '', website: '' });
  const [privacyAccepted, setPrivacy] = useState(false); const [errors, setErrors] = useState<Record<string, string>>({});
  const [status, setStatus] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle'); const [errorCode, setErrorCode] = useState('');
  const inFlight = useRef(false); const form = useRef<HTMLFormElement>(null); const collaboration = purpose === 'colaboracion';
  const set = (key: keyof typeof values, value: string) => setValues(previous => ({ ...previous, [key]: value }));
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (inFlight.current || status === 'sent') return;
    const invalid: Record<string, string> = {};
    if (values.fullName.trim().length < 2) invalid.fullName = 'Indica tu nombre (al menos 2 caracteres).';
    if (values.companyName.trim().length === 1) invalid.companyName = 'Indica al menos 2 caracteres o deja Empresa vacío.';
    if (!values.email.trim() || !form.current?.querySelector<HTMLInputElement>('#contact-email')?.validity.valid) invalid.email = 'Introduce una dirección de email válida.';
    if (!purpose) invalid.purpose = 'Selecciona el motivo de tu consulta.';
    if (!profile) invalid.profile = collaboration ? 'Selecciona el tipo de colaboración.' : 'Selecciona tu perfil.';
    if (values.message.trim().length > 0 && values.message.trim().length < 10) invalid.message = 'Escribe al menos 10 caracteres o deja el mensaje vacío.';
    if (!privacyAccepted) invalid.privacyAccepted = 'Confirma que has leído la información sobre protección de datos.';
    setErrors(invalid);
    if (Object.keys(invalid).length) { form.current?.querySelector<HTMLElement>(`[name="${Object.keys(invalid)[0]}"]`)?.focus(); return; }
    inFlight.current = true; setStatus('sending'); setErrorCode('');
    try {
      const response = await fetch('/api/contact', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...values, purpose, profile, privacyAccepted }) });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || result.ok !== true) { setErrorCode(response.status === 429 ? 'rate' : response.status === 400 ? 'validation' : 'uncertain'); setStatus('error'); return; }
      setStatus('sent');
    } catch { setErrorCode('uncertain'); setStatus('error'); } finally { inFlight.current = false; }
  };
  const disabled = status === 'sending' || status === 'sent';
  return <form ref={form} className="lp-form" noValidate onSubmit={submit} aria-busy={status === 'sending'} aria-label="Consulta comercial">
    <p>Usaremos los datos facilitados para atender tu consulta. Consulta cómo los tratamos en la <a href="/privacidad">política de privacidad</a>.</p>
    {([{ key: 'fullName', id: 'name', label: 'Nombre', help: 'Indica cómo podemos dirigirnos a ti.', max: 200, auto: 'name', required: true },
      { key: 'companyName', id: 'company', label: 'Empresa (opcional)', help: 'Nombre de la empresa o entidad, si quieres indicarlo.', max: 200, auto: 'organization', required: false },
      { key: 'email', id: 'email', label: 'Email profesional', help: 'Lo utilizaremos para responder a esta consulta.', max: 320, auto: 'email', required: true }] as const).map(field => <div className="commercial-field" key={field.key}>
      <label htmlFor={`contact-${field.id}`}>{field.label}</label><input id={`contact-${field.id}`} name={field.key} type={field.key === 'email' ? 'email' : 'text'} required={field.required} minLength={field.key === 'email' ? undefined : 2} maxLength={field.max} autoComplete={field.auto} value={values[field.key]} disabled={disabled} onChange={e => set(field.key, e.target.value)} aria-invalid={!!errors[field.key]} aria-describedby={`contact-${field.id}-help`} />
      <small id={`contact-${field.id}-help`}>{errors[field.key] ?? `${field.help} Hasta ${field.max} caracteres.`}</small></div>)}
    {!fixedProfile && <><label htmlFor="contact-purpose">Motivo de consulta</label><select id="contact-purpose" name="purpose" required value={purpose} disabled={disabled} onChange={e => { const next = e.target.value as ConsultationPurpose | ''; setPurpose(next); onPurposeChange?.(next); setProfile(''); }} aria-invalid={!!errors.purpose} aria-describedby="contact-purpose-help"><option value="">Selecciona el motivo de tu consulta</option>{consultationPurposes.map(value => <option key={value} value={value}>{purposeLabels[value]}</option>)}</select><small id="contact-purpose-help">{errors.purpose}</small></>}
    {fixedProfile ? <p>Consulta sobre: <strong>{profileLabels[fixedProfile]}</strong></p> : <><label htmlFor="contact-profile">{collaboration ? 'Modalidad de colaboración' : 'Perfil'}</label><select id="contact-profile" name="profile" required value={profile} disabled={disabled} onChange={e => setProfile(e.target.value as ConsultationProfile | '')} aria-invalid={!!errors.profile} aria-describedby="contact-profile-help"><option value="">{collaboration ? 'Selecciona el tipo de colaboración' : 'Selecciona tu perfil'}</option>{(collaboration ? collaborationProfiles : customerProfiles).map(value => <option key={value} value={value}>{profileLabels[value]}</option>)}</select><small id="contact-profile-help">{errors.profile}</small></>}
    <label htmlFor="contact-message">Mensaje (opcional)</label><textarea id="contact-message" name="message" maxLength={2000} rows={5} value={values.message} disabled={disabled} onChange={e => set('message', e.target.value)} aria-invalid={!!errors.message} aria-describedby="contact-message-help" /><small id="contact-message-help">{errors.message ?? `${collaboration ? 'Cuéntanos vuestra actividad y el perfil de vuestros clientes.' : 'Puedes describir cómo controláis actualmente la permanencia y los descansos.'} Hasta 2000 caracteres.`}</small>
    <label className="lp-honeypot" aria-hidden="true">Web<input tabIndex={-1} autoComplete="off" value={values.website} onChange={e => set('website', e.target.value)} /></label>
    <label className="lp-privacy" htmlFor="contact-privacy"><input id="contact-privacy" name="privacyAccepted" type="checkbox" required checked={privacyAccepted} disabled={disabled} onChange={e => setPrivacy(e.target.checked)} aria-invalid={!!errors.privacyAccepted} aria-describedby="contact-privacy-help" /><span>He leído la información sobre protección de datos de la <a href="/privacidad">política de privacidad</a>.</span></label><small id="contact-privacy-help">{errors.privacyAccepted}</small>
    {Object.keys(errors).length > 0 && <p role="alert">Revisa los campos indicados antes de continuar.</p>}
    <button type="submit" disabled={disabled}>{status === 'sending' ? 'Enviando solicitud…' : purpose ? purposeLabels[purpose] : 'Continuar con mi consulta'}</button>
    {status === 'sending' && <p role="status">Enviando solicitud…</p>}
    {status === 'sent' && <p role="status">{purpose === 'colaboracion' ? 'Hemos recibido tu consulta de colaboración. Revisaremos vuestra actividad para responderos sobre los siguientes pasos.' : purpose === 'presupuesto' ? 'Hemos recibido tu solicitud de presupuesto. Revisaremos los datos y te contactaremos para concretar la configuración.' : 'Hemos recibido tu consulta sobre la instalación. Revisaremos la información para responderte y concretar los siguientes pasos.'}</p>}
    {status === 'error' && <p role="alert">{errorCode === 'rate' ? 'No podemos tramitar más intentos en este momento. Inténtalo más tarde.' : errorCode === 'validation' ? 'Revisa los campos indicados antes de continuar.' : 'No hemos podido confirmar el registro de tu solicitud. Tus datos se conservan. Evita repetir el mismo mensaje mientras se comprueba su entrega.'}</p>}
  </form>;
}
