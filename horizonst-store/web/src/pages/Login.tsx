import { FormEvent, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import ErrorMessage from '../components/ErrorMessage';
import { useAuth } from '../components/AuthProvider';
import { postJson } from '../lib/api';
import type { Session } from '../lib/auth';

export default function Login() {
  const [error, setError] = useState('');
  const navigate = useNavigate();
  const { login } = useAuth();

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');

    try {
      const body = Object.fromEntries(new FormData(event.currentTarget));
      const data = await postJson<Session>('/api/auth/login', body);
      login(data);
      navigate('/dashboard');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se pudo iniciar sesión');
    }
  }

  return (
    <section className="panel narrow">
      <h1>Iniciar sesión</h1>
      <form onSubmit={submit}>
        <input name="email" type="email" placeholder="Email" required />
        <input name="password" type="password" placeholder="Contraseña" required />
        <button type="submit">Entrar</button>
      </form>
      <ErrorMessage message={error} />
      <Link to="/forgot-password">¿Has olvidado la contraseña?</Link>
    </section>
  );
}
