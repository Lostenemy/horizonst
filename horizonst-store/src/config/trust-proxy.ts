/**
 * Production topology: client -> Nginx -> Express. Trust exactly that one hop,
 * so Express uses the address appended by Nginx instead of an arbitrary first
 * value supplied in X-Forwarded-For.
 */
export const configureTrustProxy = (app: { set: (name: string, value: number) => unknown }) => app.set('trust proxy', 1);
