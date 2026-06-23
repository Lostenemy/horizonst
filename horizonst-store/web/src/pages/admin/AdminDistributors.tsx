import { FormEvent, useState } from 'react';
import { Link } from 'react-router-dom';
import { AdminShell, AsyncState } from './AdminShell';
import { submitParams } from './adminUtils';
import { useAdminLoad } from './useAdminLoad';
import type { AdminDistributorListItem, DistributorStatus } from './types';

const statuses: DistributorStatus[] = ['pending', 'needs_more_info', 'approved', 'rejected', 'suspended', 'closed'];
const fields = ['validation_status', 'email', 'company_name'];

export default function AdminDistributors() {
  const [query, setQuery] = useState('');
  const { data, error, loading } = useAdminLoad<AdminDistributorListItem[]>(`/api/admin/distributors${query}`);

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setQuery(submitParams(event.currentTarget, fields));
  };

  return (
    <AdminShell title="Distribuidores">
      <form className="filters" onSubmit={onSubmit}>
        <select name="validation_status"><option value="">Estado</option>{statuses.map((status) => <option key={status}>{status}</option>)}</select>
        <input name="email" placeholder="Email" />
        <input name="company_name" placeholder="Empresa" />
        <button>Filtrar</button>
      </form>
      <AsyncState loading={loading} error={error} empty={data?.length === 0} />
      {data?.map((distributor) => (
        <article className="summary" key={distributor.id}>
          <b>{distributor.company_name}</b>
          <span>{distributor.email} · {distributor.validation_status}</span>
          <Link to={`/admin/distributors/${distributor.id}`}>Ver detalle</Link>
        </article>
      ))}
    </AdminShell>
  );
}
