import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import ErrorMessage from '../components/ErrorMessage';
import { postJson } from '../lib/api';

export default function VerifyEmail() {
  const [params] = useSearchParams();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const token = params.get('token');

  useEffect(() => {
    if (!token) { setStatus('error'); return; }
    postJson('/api/auth/verify-email', { token })
      .then(() => setStatus('success'))
      .catch(() => setStatus('error'));
  }, [token]);

  return <section className="panel narrow">
    <h1>Verificar email</h1>
    {status === 'loading' && <p>Verificando tu correo...</p>}
    {status === 'success' && <><p className="success">Correo verificado correctamente.</p><p>Tu cuenta ya está activa. Ya puedes iniciar sesión.</p><Link className="btn" to="/login">Iniciar sesión</Link></>}
    {status === 'error' && <><ErrorMessage message="El enlace no es válido o ha caducado." /><Link to="/login">Solicitar un nuevo correo de verificación</Link></>}
  </section>;
}
