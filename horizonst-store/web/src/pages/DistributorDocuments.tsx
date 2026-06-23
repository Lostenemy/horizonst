import { useEffect, useState } from 'react';
import ErrorMessage from '../components/ErrorMessage';
import Loading from '../components/Loading';
import { api } from '../lib/api';
import type { DistributorDocument } from '../lib/types';

export default function DistributorDocuments() {
  const [documents, setDocuments] = useState<DistributorDocument[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    api<DistributorDocument[]>('/api/distributor/documents')
      .then(setDocuments)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'No se pudieron cargar los documentos'))
      .finally(() => setLoading(false));
  }, []);

  return (
    <section className="panel">
      <h1>Documentación</h1>
      <p>Documentos existentes de homologación. La subida PDF completa permanece disponible por API y queda pendiente en UI.</p>
      <ErrorMessage message={error} />
      {loading ? <Loading /> : documents.length === 0 ? <p className="empty">Sin documentos.</p> : documents.map((document) => (
        <div className="line" key={document.id}><span>{document.document_type}</span><b>{document.status}</b><small>{new Date(document.created_at).toLocaleDateString('es-ES')}</small></div>
      ))}
    </section>
  );
}
