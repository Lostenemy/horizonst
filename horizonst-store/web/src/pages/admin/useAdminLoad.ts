import { useEffect, useState } from 'react';
import { api } from '../../lib/api';
import { apiMessage } from './adminUtils';

export function useAdminLoad<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = () => {
    setLoading(true);
    setError('');
    api<T>(url)
      .then(setData)
      .catch((loadError) => setError(apiMessage(loadError)))
      .finally(() => setLoading(false));
  };

  useEffect(load, [url]);

  return { data, error, loading, load };
}
