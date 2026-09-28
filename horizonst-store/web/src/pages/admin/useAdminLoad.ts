import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../../lib/api';
import { apiMessage } from './adminUtils';

export function useAdminLoad<T>(url: string) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const generation = useRef(0);

  const load = useCallback(() => {
    const attempt = ++generation.current;
    setLoading(true);
    setError('');
    api<T>(url)
      .then((result) => { if (attempt === generation.current) setData(result); })
      .catch((loadError) => { if (attempt === generation.current) setError(apiMessage(loadError)); })
      .finally(() => { if (attempt === generation.current) setLoading(false); });
  }, [url]);

  useEffect(() => { load(); return () => { generation.current++; }; }, [load]);

  return { data, error, loading, load };
}
