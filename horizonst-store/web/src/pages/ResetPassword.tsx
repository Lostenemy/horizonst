import { FormEvent, useState } from 'react';
import ErrorMessage from '../components/ErrorMessage';
import { postJson } from '../lib/api';

export default function ResetPassword() {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    try {
      await postJson('/api/auth/reset-password', Object.fromEntries(new FormData(event.currentTarget)));
      setMessage('Contraseña actualizada.');
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo actualizar la contraseña');
    }
  }

  return (
    <section className="panel narrow">
      <h1>Restablecer contraseña</h1>
      <form onSubmit={submit}>
        <input name="token" placeholder="Token" required />
        <input name="password" type="password" minLength={10} placeholder="Nueva contraseña" required />
        <button type="submit">Actualizar</button>
      </form>
      {message && <p className="success">{message}</p>}
      <ErrorMessage message={error} />
    </section>
  );
}
