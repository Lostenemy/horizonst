import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import ErrorMessage from '../components/ErrorMessage';
import Loading from '../components/Loading';
import { api, patchJson } from '../lib/api';
import { formDataObject } from '../lib/form';
import type { DistributorProfile as DistributorProfileModel } from '../lib/types';

const fields = ['company_name','tax_id','billing_address','city','province','postal_code','country','website','contact_person'] as const;
const labels: Record<(typeof fields)[number], string> = { company_name:'Empresa', tax_id:'NIF/CIF', billing_address:'Dirección', city:'Ciudad', province:'Provincia', postal_code:'Código postal', country:'País ISO', website:'Web', contact_person:'Persona de contacto' };

export default function DistributorProfile() {
  const [profile, setProfile] = useState<DistributorProfileModel | null>(null);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    api<{ profile: DistributorProfileModel }>('/api/distributor/profile')
      .then((data) => setProfile(data.profile))
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'No se pudo cargar el perfil de distribuidor'))
      .finally(() => setLoading(false));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setSubmitting(true); setError(''); setMessage('');
    try {
      const data = await patchJson<{ profile: DistributorProfileModel }>('/api/distributor/profile', formDataObject(event.currentTarget));
      setProfile(data.profile); setMessage('Perfil actualizado.');
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo actualizar el perfil'); }
    finally { setSubmitting(false); }
  }

  return (
    <section className="panel">
      <h1>Portal distribuidor</h1>
      <div className="actions"><Link className="btn" to="/distributor/documents">Documentos</Link><Link className="btn secondary" to="/catalog">Catálogo</Link><Link className="btn secondary" to="/saas-plans">SaaS</Link><Link className="btn secondary" to="/cart">Carrito</Link></div>
      <ErrorMessage message={error} />
      {loading ? <Loading /> : profile && (
        <>
          <div className="summary"><p>Estado homologación: <b>{profile.validation_status}</b></p><p>{profile.company_name} · {profile.tax_id}</p>{profile.discount_percent != null && <p>Descuento API: <b>{profile.discount_percent}%</b></p>}{profile.review_notes && <p>Notas revisión: {profile.review_notes}</p>}</div>
          <form className="grid" onSubmit={submit}>
            {fields.map((field) => (<label key={field}>{labels[field]}<input name={field} defaultValue={profile[field] ?? ''} /></label>))}
            <button type="submit" disabled={submitting}>{submitting ? 'Guardando…' : 'Guardar'}</button>
          </form>
        </>
      )}
      {message && <p className="success">{message}</p>}
    </section>
  );
}
