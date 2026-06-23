import { FormEvent, useState } from 'react';
import ErrorMessage from '../components/ErrorMessage';
import { postJson } from '../lib/api';

type RegisterDistributorResponse = { verificationToken?: string };

const fields = [
  'fullName',
  'email',
  'phone',
  'password',
  'company_name',
  'tax_id',
  'billing_address',
  'city',
  'province',
  'postal_code',
  'country',
  'website',
  'contact_person'
];

export default function RegisterDistributor() {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      const data = await postJson<RegisterDistributorResponse>(
        '/api/auth/register-distributor',
        Object.fromEntries(new FormData(event.currentTarget))
      );
      setMessage(
        `Cuenta distribuidor pendiente de verificación y validación.${data.verificationToken ? ` Token dev: ${data.verificationToken}` : ''}`
      );
      setError('');
      event.currentTarget.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo solicitar el alta');
    }
  }

  return (
    <section className="panel">
      <h1>Registro distribuidor</h1>
      <form className="grid" onSubmit={submit}>
        {fields.map((field) => (
          <input
            key={field}
            name={field}
            type={field === 'email' ? 'email' : field === 'password' ? 'password' : 'text'}
            minLength={field === 'password' ? 10 : undefined}
            placeholder={field}
            required
          />
        ))}
        <button type="submit">Solicitar alta</button>
      </form>
      {message && <p className="success">{message}</p>}
      <ErrorMessage message={error} />
    </section>
  );
}
