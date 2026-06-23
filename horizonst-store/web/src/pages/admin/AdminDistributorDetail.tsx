import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { patchJson } from '../../lib/api';
import { AdminShell, AsyncState } from './AdminShell';
import { apiMessage } from './adminUtils';
import { useAdminLoad } from './useAdminLoad';
import type { DistributorDetailResponse, DistributorStatus } from './types';

const statusActions: DistributorStatus[] = ['approved', 'rejected', 'needs_more_info', 'suspended', 'closed'];

export default function AdminDistributorDetail() {
  const { id } = useParams();
  const { data, error, loading, load } = useAdminLoad<DistributorDetailResponse>(`/api/admin/distributors/${id}`);
  const [notes, setNotes] = useState('');
  const [busy, setBusy] = useState('');
  const [feedback, setFeedback] = useState('');

  const changeStatus = async (validation_status: DistributorStatus) => {
    setBusy(validation_status);
    setFeedback('');
    try {
      await patchJson(`/api/admin/distributors/${id}/status`, { validation_status, review_notes: notes || undefined });
      setFeedback('Estado actualizado');
      load();
    } catch (statusError) {
      setFeedback(apiMessage(statusError));
    } finally {
      setBusy('');
    }
  };

  const changeDocumentStatus = async (documentId: string, status: 'approved' | 'rejected') => {
    const review_notes = status === 'rejected' ? window.prompt('Motivo de rechazo obligatorio')?.trim() : undefined;
    if (status === 'rejected' && !review_notes) return;
    setBusy(`${documentId}:${status}`);
    try {
      await patchJson(`/api/admin/distributor-documents/${documentId}/status`, { status, review_notes });
      load();
    } catch (documentError) {
      setFeedback(apiMessage(documentError));
    } finally {
      setBusy('');
    }
  };

  const distributor = data?.distributor;

  return (
    <AdminShell title="Detalle distribuidor">
      <AsyncState loading={loading} error={error} />
      {distributor && <>
        <div className="summary">
          <b>{distributor.company_name}</b>
          <span>{distributor.email} · {distributor.validation_status}</span>
          <span>{distributor.tax_id}</span>
        </div>
        <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Notas de revisión" />
        <div className="actions">
          {statusActions.map((status) => <button disabled={!!busy} key={status} onClick={() => changeStatus(status)}>{status}</button>)}
        </div>
        {feedback && <p className={feedback === 'Estado actualizado' ? 'success' : 'error'}>{feedback}</p>}

        <h2>Documentos</h2>
        {data.documents.length === 0 && <div className="empty">Sin documentos.</div>}
        {data.documents.map((document) => (
          <article className="summary" key={document.id}>
            <b>{document.document_type}</b>
            <span>{document.file_name} · {document.status}</span>
            <div className="actions">
              <a className="btn" href={`/api/admin/distributor-documents/${document.id}/download`}>Descargar</a>
              <button disabled={!!busy} onClick={() => changeDocumentStatus(document.id, 'approved')}>Aprobar</button>
              <button disabled={!!busy} onClick={() => changeDocumentStatus(document.id, 'rejected')}>Rechazar</button>
            </div>
          </article>
        ))}
      </>}
    </AdminShell>
  );
}
