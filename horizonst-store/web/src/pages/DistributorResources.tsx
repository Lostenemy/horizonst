import { useEffect, useMemo, useState } from 'react';
import ErrorMessage from '../components/ErrorMessage';
import Loading from '../components/Loading';
import { api, downloadFile } from '../lib/api';
import type { DistributorResource } from '../lib/types';

const categoryLabels: Record<DistributorResource['category'], string> = {
  commercial: 'Comercial', technical: 'Técnica', pricing: 'Tarifas', legal: 'Legal / contractual', training: 'Formación', other: 'Otros'
};
const fileSize = (bytes: number) => bytes >= 1024 * 1024 ? `${(bytes / 1024 / 1024).toFixed(1)} MB` : `${Math.ceil(bytes / 1024)} KB`;

export default function DistributorResources() {
  const [resources, setResources] = useState<DistributorResource[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState<string>();
  const [error, setError] = useState('');

  useEffect(() => {
    api<{ resources: DistributorResource[] }>('/api/distributor/resources').then((data) => setResources(data.resources))
      .catch((caught: unknown) => setError(caught instanceof Error ? caught.message : 'No se pudo cargar la documentación.'))
      .finally(() => setLoading(false));
  }, []);
  const visible = useMemo(() => resources.filter((resource) => `${resource.title} ${resource.description ?? ''} ${categoryLabels[resource.category]}`.toLowerCase().includes(search.trim().toLowerCase())), [resources, search]);
  const grouped = useMemo(() => Object.entries(visible.reduce<Partial<Record<DistributorResource['category'], DistributorResource[]>>>((groups, resource) => {
    (groups[resource.category] ??= []).push(resource); return groups;
  }, {})) as Array<[DistributorResource['category'], DistributorResource[]]>, [visible]);
  const download = async (resource: DistributorResource) => {
    setDownloading(resource.id); setError('');
    try { await downloadFile(`/api/distributor/resources/${resource.id}/download`, resource.original_filename); }
    catch (caught) { setError(caught instanceof Error ? caught.message : 'No se pudo descargar el documento.'); }
    finally { setDownloading(undefined); }
  };

  return <section className="panel distributor-resource-center">
    <header className="resource-center-header"><div><span className="resource-eyebrow">Portal distribuidor</span><h1>Documentación</h1><p>Documentación comercial y técnica puesta a tu disposición por HorizonST.</p></div></header>
    <ErrorMessage message={error} />
    <label className="resource-search">Buscar documentos<input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar por título, descripción o categoría…" /></label>
    {loading ? <Loading /> : resources.length === 0 ? <div className="resource-empty"><b>No hay documentación disponible en este momento.</b><span>Los nuevos documentos aparecerán aquí cuando HorizonST los publique.</span></div> : visible.length === 0 ? <div className="resource-empty">No hay documentos que coincidan con la búsqueda.</div> : grouped.map(([category, documents]) => <section className="resource-category" key={category}>
      <h2>{categoryLabels[category]}</h2>
      <div className="resource-list">{documents.map((resource) => <article className="resource-card" key={resource.id}>
        <div className="resource-icon" aria-hidden="true">PDF</div><div className="resource-copy"><h3>{resource.title}</h3>{resource.description && <p>{resource.description}</p>}<span>{resource.original_filename} · {fileSize(resource.file_size_bytes)} · Publicado: {new Date(resource.published_at).toLocaleDateString('es-ES')}</span></div>
        <button type="button" onClick={() => download(resource)} disabled={downloading === resource.id}>{downloading === resource.id ? 'Descargando…' : 'Descargar'}</button>
      </article>)}</div>
    </section>)}
  </section>;
}
