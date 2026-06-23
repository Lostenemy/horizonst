import { FormEvent, useState } from 'react';
import { postJson } from '../lib/api';

type PasswordResetResponse = { message: string; resetToken?: string };

export default function ForgotPassword() {
  const [message, setMessage] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const data = await postJson<PasswordResetResponse>(
      '/api/auth/request-password-reset',
      Object.fromEntries(new FormData(event.currentTarget))
    );
    setMessage(`${data.message}${data.resetToken ? ` Token dev: ${data.resetToken}` : ''}`);
  }

  return (
    <section className="panel narrow">
      <h1>Recuperar contraseña</h1>
      <form onSubmit={submit}>
        <input name="email" type="email" placeholder="Email" required />
        <button type="submit">Solicitar token</button>
      </form>
      {message && <p className="success">{message}</p>}
    </section>
  );
}
