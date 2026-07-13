import { FormEvent, useState } from 'react';
import { patchJson, postJson } from '../../lib/api';
import { AdminShell, AsyncState } from './AdminShell';
import { apiMessage, submitParams } from './adminUtils';
import { useAdminLoad } from './useAdminLoad';
import type { AdminCustomer, AdminCustomersResponse } from './types';

const statuses = ['pending_email_verification', 'active', 'suspended', 'closed'] as const;
const filters = ['status', 'email', 'full_name'];
const messages = {
  active: 'Cliente reactivado correctamente.',
  suspended: 'Cliente suspendido correctamente.',
  closed: 'Cliente cerrado correctamente.'
} as const;

const formatDate = (value: string | null) => value ? new Date(value).toLocaleString('es-ES') : 'Sin acceso registrado';

export default function AdminCustomers() {
  const [query, setQuery] = useState('');
  const [feedback, setFeedback] = useState('');
  const { data, error, loading, load } = useAdminLoad<AdminCustomersResponse>(`/api/admin/customers${query}`);

  const onFilter = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setQuery(submitParams(event.currentTarget, filters));
  };

  const changeStatus = async (customer: AdminCustomer, status: 'active' | 'suspended' | 'closed') => {
    if (status === 'suspended' && !window.confirm('¿Confirmas que quieres suspender este cliente?')) return;
    if (status === 'closed' && !window.confirm('¿Confirmas que quieres cerrar definitivamente esta cuenta?')) return;
    try {
      await patchJson(`/api/admin/customers/${customer.id}/status`, { status });
      setFeedback(customer.status === 'suspended' && status === 'active' ? 'Cliente reactivado correctamente.' : messages[status]);
      load();
    } catch (changeError) { setFeedback(apiMessage(changeError)); }
  };

  const resendVerification = async (customer: AdminCustomer) => {
    try {
      await postJson(`/api/admin/customers/${customer.id}/resend-verification`, {});
      setFeedback('Correo de verificación reenviado correctamente.');
      load();
    } catch (resendError) {
      const message = apiMessage(resendError);
      setFeedback(message.includes('temporarily limited') ? 'Debes esperar antes de volver a enviar el correo de verificación.' : message);
    }
  };

  return <AdminShell title="Clientes">
    <form className="filters" onSubmit={onFilter}>
      <select name="status"><option value="">Estado</option>{statuses.map((status) => <option key={status}>{status}</option>)}</select>
      <input name="email" placeholder="Email" />
      <input name="full_name" placeholder="Nombre" />
      <button>Filtrar</button>
    </form>
    {feedback && <p className={feedback.includes('correctamente') ? 'success' : 'error'}>{feedback}</p>}
    <AsyncState loading={loading} error={error} empty={data?.customers.length === 0} />
    {data?.customers.map((customer) => <article className="summary" key={customer.id}>
      <b>{customer.full_name}</b>
      <span>{customer.email} · {customer.phone || 'Sin teléfono'} · {customer.status}</span>
      <span>Alta: {formatDate(customer.created_at)} · Último acceso: {formatDate(customer.last_login_at)}</span>
      <div className="actions">
        {customer.status === 'pending_email_verification' && <><button onClick={() => resendVerification(customer)}>Reenviar correo de verificación</button><button onClick={() => changeStatus(customer, 'closed')}>Cerrar</button></>}
        {customer.status === 'active' && <><button onClick={() => changeStatus(customer, 'suspended')}>Suspender</button><button onClick={() => changeStatus(customer, 'closed')}>Cerrar</button></>}
        {customer.status === 'suspended' && <><button onClick={() => changeStatus(customer, 'active')}>Reactivar</button><button onClick={() => changeStatus(customer, 'closed')}>Cerrar</button></>}
      </div>
    </article>)}
  </AdminShell>;
}
