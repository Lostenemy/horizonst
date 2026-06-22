import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { DistributorDocument } from '../lib/types';

export default function DistributorDocuments() {
  const [documents, setDocuments] = useState<DistributorDocument[]>([]);

  useEffect(() => {
    api<DistributorDocument[]>('/api/distributor/documents').then(setDocuments);
  }, []);

  return (
    <section className="panel">
      <h1>Documentación</h1>
      <p>Listado documental. La subida PDF completa queda como pendiente de Fase 5B.</p>
      {documents.length === 0 ? (
        <p className="muted">Sin documentos.</p>
      ) : (
        documents.map((document) => (
          <div className="line" key={document.id}>
            <span>{document.document_type}</span>
            <b>{document.status}</b>
            <small>{new Date(document.created_at).toLocaleDateString('es-ES')}</small>
          </div>
        ))
      )}
    </section>
  );
}
