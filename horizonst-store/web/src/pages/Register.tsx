import { FormEvent, useState } from 'react';
import ErrorMessage from '../components/ErrorMessage';
import { postJson } from '../lib/api';

type RegisterResponse = { verificationToken?: string };

export default function Register() {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setMessage('');

    try {
      const data = await postJson<RegisterResponse>(
        '/api/auth/register',
        Object.fromEntries(new FormData(event.currentTarget))
      );
      setMessage(
        `Cuenta creada pendiente de verificación.${data.verificationToken ? ` Token dev: ${data.verificationToken}` : ''}`
      );
      event.currentTarget.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la cuenta');
    }
  }

  return (
    <section className="panel narrow">
      <h1>Registro cliente</h1>
      <form onSubmit={submit}>
        <input name="fullName" placeholder="Nombre completo" required />
        <input name="email" type="email" placeholder="Email" required />
        <input name="phone" placeholder="Teléfono" />
        <input name="password" type="password" minLength={10} placeholder="Contraseña (mín. 10)" required />
        <button type="submit">Crear cuenta</button>
      </form>
      {message && <p className="success">{message}</p>}
      <ErrorMessage message={error} />
    </section>
  );
}
