import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import { auth, type Session } from '../lib/auth';
import type { User } from '../lib/types';

type AuthState = { loading: boolean; authenticated: boolean; user: User | null; login: (session: Session) => void; logout: () => void; refreshUser: () => Promise<void> };
const AuthContext = createContext<AuthState | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true);
  const [user, setUser] = useState<User | null>(auth.user);
  const setSessionUser = (nextUser: User | null) => { auth.setUser(nextUser); setUser(nextUser); };
  const refreshUser = async () => { const data = await api<{ user: User }>('/api/auth/me'); setSessionUser(data.user); };

  useEffect(() => {
    let mounted = true;
    async function bootstrap() {
      if (!auth.accessToken && !auth.refreshToken) { if (mounted) setLoading(false); return; }
      try {
        const data = await api<{ user: User }>('/api/auth/me');
        if (mounted) setSessionUser(data.user);
      } catch {
        auth.clear();
        if (mounted) setUser(null);
      } finally { if (mounted) setLoading(false); }
    }
    bootstrap(); return () => { mounted = false; };
  }, []);

  const value = useMemo<AuthState>(() => ({ loading, authenticated: Boolean(user && auth.accessToken), user, login(session: Session) { auth.save(session); setUser(session.user); }, logout() { auth.clear(); setUser(null); }, refreshUser }), [loading, user]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() { const context = useContext(AuthContext); if (!context) throw new Error('useAuth must be used inside AuthProvider'); return context; }
