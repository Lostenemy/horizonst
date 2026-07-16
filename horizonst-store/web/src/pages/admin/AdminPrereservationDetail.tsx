import { useParams } from 'react-router-dom';
import type { AdminPrereservationDetailResponse } from '../../lib/types';
import { AdminShell, AsyncState } from './AdminShell';
import { useAdminLoad } from './useAdminLoad';

const offerNames = { starter: 'Starter', professional: 'Professional', enterprise: 'Enterprise' } as const;

export default function AdminPrereservationDetail() {
  const { id } = useParams();
  const { data, error, loading } = useAdminLoad<AdminPrereservationDetailResponse>(`/api/admin/prereservations/${id}`);
  const item = data?.prereservation;
  return <AdminShell title="Detalle de prerreserva">
    <AsyncState loading={loading} error={error} />
    {item && <div className="summary">
      <b>{item.email}</b>
      <span>Oferta: {offerNames[item.offer_code]} · Campaña: {item.campaign_code} · Estado: {item.status}</span>
      <span>Primer interés: {new Date(item.created_at).toLocaleString('es-ES')}</span>
      <span>Última interacción: {new Date(item.last_interest_at).toLocaleString('es-ES')}</span>
      <span>Confirmada: {item.confirmed_at ? new Date(item.confirmed_at).toLocaleString('es-ES') : 'Pendiente'}</span>
      <span>Correo cliente: {item.confirmation_email_status} · Intentos: {item.confirmation_email_attempts}</span>
      <span>Notificación comercial: {item.commercial_email_sent_at ? 'Enviada' : item.commercial_email_last_error_at ? 'Fallida' : 'Pendiente'} · Intentos: {item.commercial_email_attempts}</span>
      <span>Lead asociado: {item.lead_id}</span>
    </div>}
  </AdminShell>;
}
