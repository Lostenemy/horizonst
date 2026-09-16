import { isIP } from 'node:net';

// Confiar solo en el par Nginx -> contenedor; un simple hop count también
// aceptaría X-Forwarded-For de conexiones directas al puerto local.
export function createTrustedProxy(address) {
  if (!isIP(address)) return () => false;
  return (remoteAddress, hop) => hop === 0 &&
    (remoteAddress === address || remoteAddress === `::ffff:${address}`);
}
