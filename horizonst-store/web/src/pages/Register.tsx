import { FormEvent, useState } from 'react';
import ErrorMessage from '../components/ErrorMessage';
import { postJson } from '../lib/api';

type RegisterResponse = { verificationToken?: string; verificationEmailSent?: boolean };

export default function Register() {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    setError('');
    setMessage('');

    try {
      const data = await postJson<RegisterResponse>(
        '/api/auth/register',
        Object.fromEntries(new FormData(form))
      );
      setMessage(data.verificationEmailSent === false
        ? 'Cuenta creada, pero no se pudo enviar el correo de verificación. Puedes solicitar un nuevo envío desde la pantalla de acceso.'
        : `Cuenta creada. Te hemos enviado un correo para verificar tu dirección.${data.verificationToken ? ` Token dev: ${data.verificationToken}` : ''}`);
      form.reset();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo crear la cuenta');
    }
  }

  return (
    <section className="panel narrow">
      <h1>Registro cliente</h1>
      <form onSubmit={submit}>
        <label htmlFor="register-name">Nombre completo</label><input id="register-name" name="fullName" autoComplete="name" required />
        <label htmlFor="register-email">Email</label><input id="register-email" name="email" type="email" autoComplete="email" required />
        <label htmlFor="register-phone">Teléfono (opcional)</label><input id="register-phone" name="phone" type="tel" autoComplete="tel" />
        <label htmlFor="register-password">Contraseña</label><input id="register-password" name="password" type="password" minLength={10} autoComplete="new-password" aria-describedby="password-help" required />
        <p id="password-help" className="muted">Al menos 10 caracteres.</p>
        <button type="submit">Crear cuenta</button>
      </form>
      {message && <p className="success">{message}</p>}
      <ErrorMessage message={error} />
    </section>
  );
}
