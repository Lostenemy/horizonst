import { FormEvent, useEffect, useState } from 'react';
import { api, downloadFile, patchJson } from '../../lib/api';
import { AdminShell, AsyncState } from './AdminShell';
import { apiMessage } from './adminUtils';
import type { AdminDistributorResourcesResponse, DistributorResourceTarget, DistributorResourceTargetsResponse } from './types';
import { useAdminLoad } from './useAdminLoad';

const categories = [['commercial', 'Comercial'], ['technical', 'Técnica'], ['pricing', 'Tarifas'], ['legal', 'Legal / contractual'], ['training', 'Formación'], ['other', 'Otros']] as const;
const categoryLabel = Object.fromEntries(categories) as Record<string, string>;

export default function AdminDistributorResources() {
  const { data, error: loadError, loading, load } = useAdminLoad<AdminDistributorResourcesResponse>('/api/admin/distributor-resources');
  const [distributors, setDistributors] = useState<DistributorResourceTarget[]>([]);
  const [visibility, setVisibility] = useState<'global' | 'targeted'>('global');
  const [error, setError] = useState(''); const [message, setMessage] = useState(''); const [submitting, setSubmitting] = useState(false);
  useEffect(() => { api<DistributorResourceTargetsResponse>('/api/admin/distributor-resources/distributors').then((response) => setDistributors(response.distributors)).catch((caught) => setError(apiMessage(caught))); }, []);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setSubmitting(true); setError(''); setMessage('');
    const form = event.currentTarget; const formData = new FormData(form);
    formData.set('distributor_user_ids', JSON.stringify(formData.getAll('distributor_user_id'))); formData.delete('distributor_user_id');
    try { await api('/api/admin/distributor-resources', { method: 'POST', body: formData }); form.reset(); setVisibility('global'); setMessage('Documento publicado correctamente.'); load(); }
    catch (caught) { setError(apiMessage(caught)); } finally { setSubmitting(false); }
  };
  const toggleActive = async (id: string, active: boolean) => {
    setError(''); try { await patchJson(`/api/admin/distributor-resources/${id}`, { active }); setMessage(active ? 'Documento activado.' : 'Documento archivado.'); load(); } catch (caught) { setError(apiMessage(caught)); }
  };

  return <AdminShell title="Documentación de distribuidores">
    <p className="muted">Publica recursos de HorizonST para todos los distribuidores o para destinatarios concretos. Los archivos se guardan en el volumen persistente del Store.</p>
    {(error || loadError) && <p className="error" role="alert">{error || loadError}</p>}{message && <p className="success" role="status">{message}</p>}
    <form className="admin-resource-form" onSubmit={submit}>
      <label>Título *<input name="title" maxLength={200} required /></label>
      <label>Categoría *<select name="category" required>{categories.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
      <label>Visibilidad *<select name="visibility" value={visibility} onChange={(event) => setVisibility(event.target.value as typeof visibility)}><option value="global">Todos los distribuidores</option><option value="targeted">Distribuidores específicos</option></select></label>
      <label className="admin-resource-description">Descripción<textarea name="description" maxLength={2000} rows={3} /></label>
      {visibility === 'targeted' && <label className="admin-resource-targets">Distribuidores *<select name="distributor_user_id" multiple required size={Math.min(7, Math.max(3, distributors.length))}>{distributors.map((distributor) => <option value={distributor.id} key={distributor.id}>{distributor.company_name} · {distributor.full_name} · {distributor.email}</option>)}</select><span className="field-hint">Puedes seleccionar varios distribuidores con Ctrl/Cmd.</span></label>}
      <label className="admin-resource-file">Archivo PDF *<input name="file" type="file" accept="application/pdf,.pdf" required /><span className="field-hint">PDF, máximo 20 MB.</span></label>
      <div className="admin-resource-submit"><button type="submit" disabled={submitting}>{submitting ? 'Publicando…' : 'Publicar documento'}</button></div>
    </form>
    <h2>Documentos publicados</h2><AsyncState loading={loading} empty={!data?.resources.length} />
    <div className="admin-resource-list">{data?.resources.map((resource) => <article className={`admin-resource-row${resource.active ? '' : ' archived'}`} key={resource.id}>
      <div><b>{resource.title}</b><span>{categoryLabel[resource.category]} · {resource.visibility === 'global' ? 'Todos los distribuidores' : resource.distributors.map((item) => item.company_name).join(', ')}</span><small>{resource.original_filename} · {Math.ceil(resource.file_size_bytes / 1024)} KB · {resource.active ? 'Activo' : 'Archivado'}</small></div>
      <div className="actions"><button type="button" className="secondary" onClick={() => downloadFile(`/api/admin/distributor-resources/${resource.id}/download`, resource.original_filename)}>Descargar</button><button type="button" className="secondary" onClick={() => toggleActive(resource.id, !resource.active)}>{resource.active ? 'Archivar' : 'Activar'}</button></div>
    </article>)}</div>
  </AdminShell>;
}
