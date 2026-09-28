// Lista cerrada: nunca derivar destinos de cabeceras o sufijos de dominio.
const production = { marketing: 'https://horizonst.es', store: 'https://tienda.horizonst.es', publicHosts: ['horizonst.es', 'www.horizonst.es'] } as const;
const staging = { marketing: 'https://horizonst.com.es', store: 'https://tienda.horizonst.com.es', publicHosts: ['horizonst.com.es', 'www.horizonst.com.es'] } as const;
const domains = new Map<string, { marketing: string; store: string; publicHosts: readonly string[] }>([
  ...[...production.publicHosts, 'tienda.horizonst.es'].map((host) => [host, production] as const),
  ...[...staging.publicHosts, 'tienda.horizonst.com.es'].map((host) => [host, staging] as const)
]);

export const domainEnvironment = (hostname: string) => domains.get(hostname.toLowerCase());
export const isPublicMarketingHost = (hostname: string) =>
  domainEnvironment(hostname)?.publicHosts.some((host) => host === hostname.toLowerCase()) ?? false;
