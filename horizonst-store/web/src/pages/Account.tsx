import { FormEvent, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../components/AuthProvider';
import { api, patchJson } from '../lib/api';
import type { CustomerProfile } from '../lib/types';

const profileFields = [
  ['fullName', 'full_name'],
  ['phone', 'phone'],
  ['companyName', 'company_name'],
  ['taxId', 'tax_id'],
  ['billingAddress', 'billing_address'],
  ['city', 'city'],
  ['province', 'province'],
  ['postalCode', 'postal_code'],
  ['country', 'country']
] as const;

export default function Account() {
  const { user } = useAuth();
  const [profile, setProfile] = useState<CustomerProfile | null>(null);
  const [message, setMessage] = useState('');

  useEffect(() => {
    if (user?.role !== 'distributor') {
      api<{ profile: CustomerProfile }>('/api/customer/profile').then((data) => setProfile(data.profile));
    }
  }, [user?.role]);

  if (user?.role === 'distributor') {
    return (
      <section className="panel">
        <h1>Cuenta</h1>
        <p>Tu perfil se gestiona desde el portal de distribuidor.</p>
        <Link className="btn" to="/distributor/profile">Ir al perfil</Link>
      </section>
    );
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = await patchJson<{ profile: CustomerProfile }>(
      '/api/customer/profile',
      Object.fromEntries(new FormData(event.currentTarget))
    );
    setProfile(data.profile);
    setMessage('Perfil actualizado');
  }

  return (
    <section className="panel">
      <h1>Cuenta</h1>
      {profile && (
        <form className="grid" onSubmit={submit}>
          {profileFields.map(([field, backendField]) => (
            <input key={field} name={field} placeholder={field} defaultValue={profile[backendField] ?? ''} />
          ))}
          <button type="submit">Guardar</button>
        </form>
      )}
      {message && <p className="success">{message}</p>}
    </section>
  );
}
