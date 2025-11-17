import 'express-session';

declare module 'express-session' {
  interface SessionData {
    authenticated?: boolean;
    username?: string;
    role?: 'admin' | 'user';
  }
}

export {};
