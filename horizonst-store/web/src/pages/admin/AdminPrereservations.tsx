import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import type { AdminPrereservationsResponse } from '../../lib/types';
import { AdminShell, AsyncState } from './AdminShell';
import { submitParams } from './adminUtils';
import { useAdminLoad } from './useAdminLoad';

const fields = ['email', 'offer', 'status', 'date_from', 'date_to'];
const offers = ['starter', 'professional', 'enterprise'];
const offerNames = { starter: 'Starter', professional: 'Professional', enterprise: 'Enterprise' } as const;

export default function AdminPrereservations() {
  const [query, setQuery] = useState('');
  const { data, error, loading } = useAdminLoad<AdminPrereservationsResponse>(`/api/admin/prereservations${query}`);
  const onSubmit = (event: FormEvent<HTMLFormElement>) => { event.preventDefault(); setQuery(submitParams(event.currentTarget, fields)); };
  return <AdminShell title="Prerreservas">
    <form className="filters" onSubmit={onSubmit}>
      <input name="email" type="email" placeholder="Email" />
      <select name="offer"><option value="">Oferta</option>{offers.map((offer) => <option key={offer}>{offer}</option>)}</select>
      <select name="status"><option value="">Estado</option><option value="pending">Pendiente</option><option value="confirmed">Confirmada</option></select>
      <label>Desde<input name="date_from" type="date" /></label>
      <label>Hasta<input name="date_to" type="date" /></label>
      <button>Filtrar</button>
    </form>
    <AsyncState loading={loading} error={error} empty={data?.prereservations.length === 0} />
    {data?.prereservations.map((item) => <article className="summary" key={item.id}>
      <b>{item.email}</b>
      <span>{offerNames[item.offer_code]} · {item.campaign_code} · {item.status}</span>
      <span>Primer interés: {new Date(item.created_at).toLocaleString('es-ES')} · Última interacción: {new Date(item.last_interest_at).toLocaleString('es-ES')}</span>
      <span>Confirmación: {item.confirmed_at ? new Date(item.confirmed_at).toLocaleString('es-ES') : 'Pendiente'} · Correo: {item.confirmation_email_status}</span>
      <span>Lead: {item.lead_id}</span>
      <Link to={`/admin/prereservations/${item.id}`}>Ver detalle</Link>
    </article>)}
  </AdminShell>;
}
