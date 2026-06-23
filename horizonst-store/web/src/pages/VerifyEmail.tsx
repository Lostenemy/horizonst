import { FormEvent, useState } from 'react';
import ErrorMessage from '../components/ErrorMessage';
import { postJson } from '../lib/api';

export default function VerifyEmail() {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      await postJson('/api/auth/verify-email', Object.fromEntries(new FormData(event.currentTarget)));
      setMessage('Email verificado. Ya puedes iniciar sesión.');
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo verificar el email');
    }
  }

  return (
    <section className="panel narrow">
      <h1>Verificar email</h1>
      <form onSubmit={submit}>
        <input name="token" placeholder="Token" required />
        <button type="submit">Verificar</button>
      </form>
      {message && <p className="success">{message}</p>}
      <ErrorMessage message={error} />
    </section>
  );
}
