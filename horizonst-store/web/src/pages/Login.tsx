import { FormEvent, useState } from 'react';
import { Link, useLocation, useNavigate } from 'react-router-dom';
import ErrorMessage from '../components/ErrorMessage';
import { useAuth } from '../components/AuthProvider';
import { postJson } from '../lib/api';
import { formDataObject } from '../lib/form';
import { defaultRouteForRole } from '../lib/routes';
import type { Session } from '../lib/auth';

type LocationState = { from?: string } | null;

export default function Login() {
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const navigate = useNavigate();
  const location = useLocation();
  const { login } = useAuth();
  const from = (location.state as LocationState)?.from;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSubmitting(true);

    try {
      const data = await postJson<Session>('/api/auth/login', formDataObject(event.currentTarget));
      login(data);
      navigate(from && from !== '/login' ? from : defaultRouteForRole(data.user.role), { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión. Revisa email, contraseña y verificación.');
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <section className="panel narrow">
      <h1>Iniciar sesión</h1>
      <p className="muted">Accede con una cuenta verificada. Te llevaremos automáticamente a tu área según el rol.</p>
      <form onSubmit={submit}>
        <label>Email<input name="email" type="email" autoComplete="email" required /></label>
        <label>Contraseña<input name="password" type="password" autoComplete="current-password" required /></label>
        <button type="submit" disabled={submitting}>{submitting ? 'Entrando…' : 'Entrar'}</button>
      </form>
      <ErrorMessage message={error} />
      <div className="inline-links">
        <Link to="/forgot-password">¿Has olvidado la contraseña?</Link>
        <Link to="/verify-email">Verificar email</Link>
      </div>
    </section>
  );
}
