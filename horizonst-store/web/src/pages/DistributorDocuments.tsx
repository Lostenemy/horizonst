import { useCallback, useEffect, useState } from 'react';
import ErrorMessage from '../components/ErrorMessage';
import Loading from '../components/Loading';
import { api, downloadFile } from '../lib/api';
import type { DistributorDocument, DistributorDocumentsResponse } from '../lib/types';

const statusLabels = { pending: 'Pendiente de revisión', approved: 'Aprobado', rejected: 'Rechazado', replaced: 'Reemplazado' } as const;

export default function DistributorDocuments() {
  const [data, setData] = useState<DistributorDocumentsResponse | null>(null);
  const [files, setFiles] = useState<Record<string, File | undefined>>({});
  const [busy, setBusy] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');

  const load = useCallback(async () => {
    try { setData(await api<DistributorDocumentsResponse>('/api/distributor/documents')); setError(''); }
    catch (err) { setError(err instanceof Error ? err.message : 'No se pudieron cargar los documentos'); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const currentDocument = (acceptedTypes: string[]): DistributorDocument | undefined =>
    data?.documents.find((document) => acceptedTypes.includes(document.document_type));

  const upload = async (documentType: string) => {
    const file = files[documentType];
    if (!file) { setError('Selecciona un archivo PDF antes de subirlo.'); return; }
    const form = new FormData(); form.append('documentType', documentType); form.append('file', file);
    setBusy(documentType); setError(''); setMessage('');
    try {
      await api('/api/distributor/documents', { method: 'POST', body: form });
      setFiles((current) => ({ ...current, [documentType]: undefined }));
      setMessage('Documento enviado correctamente para revisión.');
      await load();
    } catch (err) { setError(err instanceof Error ? err.message : 'No se pudo subir el documento'); }
    finally { setBusy(''); }
  };

  return (
    <section className="verification-documents">
      <header className="section-heading">
        <div><small>Validación de distribuidor</small><h1>Mis documentos</h1><p className="muted">Aporta la documentación requerida para que HorizonST pueda validar tu cuenta y activar el descuento.</p></div>
      </header>
      <ErrorMessage message={error} />
      {message && <p className="success">{message}</p>}
      {loading ? <Loading /> : !data ? null : (
        <div className="verification-list">
          {data.requirements.map((requirement) => {
            const document = currentDocument(requirement.acceptedTypes);
            const status = document?.status;
            const replaceable = !document || status === 'pending' || status === 'rejected';
            return (
              <article className="verification-card" key={requirement.code}>
                <div className="verification-copy">
                  <div className="verification-title"><h2>{requirement.label}</h2><span className={`status-badge ${status ?? 'missing'}`}>{status ? statusLabels[status] : 'Pendiente de subir'}</span></div>
                  <p>{requirement.description}</p>
                  {document && <p className="document-meta">{document.file_name} · {(document.file_size_bytes / 1024).toFixed(0)} KB · {new Date(document.created_at).toLocaleDateString('es-ES')}</p>}
                  {document && status === 'rejected' && document.review_notes && <p className="rejection-reason"><strong>Motivo:</strong> {document.review_notes}</p>}
                </div>
                <div className="verification-actions">
                  {document && <button type="button" className="secondary" onClick={() => downloadFile(`/api/distributor/documents/${document!.id}/download`, document!.file_name).catch((err) => setError(err instanceof Error ? err.message : 'No se pudo descargar'))}>Descargar</button>}
                  {replaceable && <>
                    <label className="file-picker">{document ? 'Reemplazar PDF' : 'Seleccionar PDF'}<input type="file" accept="application/pdf,.pdf" onChange={(event) => setFiles((current) => ({ ...current, [requirement.code]: event.target.files?.[0] }))} /></label>
                    <button type="button" disabled={!files[requirement.code] || busy === requirement.code} onClick={() => upload(requirement.code)}>{busy === requirement.code ? 'Subiendo…' : document ? 'Enviar reemplazo' : 'Subir documento'}</button>
                  </>}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
