export type Role = 'customer' | 'distributor' | 'admin';
export type User = { id: string; email: string; full_name: string; phone?: string | null; role: Role; status: string; created_at?: string; last_login_at?: string | null };
export type Session = { user: User; accessToken: string; refreshToken?: string };
const ACCESS = 'horizonst.accessToken';
const REFRESH = 'horizonst.refreshToken';
let currentUser: User | null = null;
export const auth = {
  get accessToken() { return localStorage.getItem(ACCESS); },
  get refreshToken() { return localStorage.getItem(REFRESH); },
  get user() { return currentUser; },
  setUser(user: User | null) { currentUser = user; },
  save(session: Session) { localStorage.setItem(ACCESS, session.accessToken); if (session.refreshToken) localStorage.setItem(REFRESH, session.refreshToken); currentUser = session.user; },
  clear() { localStorage.removeItem(ACCESS); localStorage.removeItem(REFRESH); currentUser = null; },
  isAuthenticated() { return Boolean(localStorage.getItem(ACCESS)); }
};
