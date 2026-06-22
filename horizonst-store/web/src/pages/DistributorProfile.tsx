import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, patchJson } from '../lib/api';
import type { DistributorProfile as DistributorProfileModel } from '../lib/types';

const fields = [
  'company_name',
  'tax_id',
  'billing_address',
  'city',
  'province',
  'postal_code',
  'country',
  'website',
  'contact_person'
] as const;

export default function DistributorProfile() {
  const [profile, setProfile] = useState<DistributorProfileModel | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    api<{ profile: DistributorProfileModel }>('/api/distributor/profile').then((data) => setProfile(data.profile));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = await patchJson<{ profile: DistributorProfileModel }>(
      '/api/distributor/profile',
      Object.fromEntries(new FormData(event.currentTarget))
    );
    setProfile(data.profile);
    setMessage('Perfil actualizado');
  }

  return (
    <section className="panel">
      <h1>Portal distribuidor</h1>
      <Link to="/distributor/documents">Documentos</Link>
      {profile && (
        <>
          <p>Estado validación: <b>{profile.validation_status}</b></p>
          <form className="grid" onSubmit={submit}>
            {fields.map((field) => (
              <input key={field} name={field} placeholder={field} defaultValue={profile[field] ?? ''} />
            ))}
            <button type="submit">Guardar</button>
          </form>
        </>
      )}
      {message && <p className="success">{message}</p>}
    </section>
  );
}
