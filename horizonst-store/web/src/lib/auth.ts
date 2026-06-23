import type { User } from './types';

export type Session = {
  user: User;
  accessToken: string;
  refreshToken?: string;
};

const ACCESS = 'horizonst.accessToken';
const REFRESH = 'horizonst.refreshToken';

let currentUser: User | null = null;

export const auth = {
  get accessToken() {
    return localStorage.getItem(ACCESS);
  },
  get refreshToken() {
    return localStorage.getItem(REFRESH);
  },
  get user() {
    return currentUser;
  },
  setAccessToken(accessToken: string) {
    localStorage.setItem(ACCESS, accessToken);
  },
  setUser(user: User | null) {
    currentUser = user;
  },
  save(session: Session) {
    localStorage.setItem(ACCESS, session.accessToken);
    if (session.refreshToken) localStorage.setItem(REFRESH, session.refreshToken);
    currentUser = session.user;
  },
  clear() {
    localStorage.removeItem(ACCESS);
    localStorage.removeItem(REFRESH);
    currentUser = null;
  },
  isAuthenticated() {
    return Boolean(localStorage.getItem(ACCESS));
  }
};
