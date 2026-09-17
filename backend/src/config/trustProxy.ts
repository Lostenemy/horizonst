import { isIP } from 'node:net';

export const createTrustedProxy = (configuredIp?: string) => {
  const trustedIp = configuredIp?.trim();
  if (!trustedIp) return (_address: string) => false;
  if (isIP(trustedIp) === 0) throw new Error('TRUSTED_PROXY_IP must be one exact IP address');
  const accepted = new Set([trustedIp.toLowerCase()]);
  if (isIP(trustedIp) === 4) accepted.add(`::ffff:${trustedIp}`);
  return (address: string) => accepted.has(address.toLowerCase());
};

export const configureTrustProxy = (
  app: { set: (name: string, value: (address: string) => boolean) => unknown },
  configuredIp?: string
) => app.set('trust proxy', createTrustedProxy(configuredIp));
