import { domainEnvironment } from '../../../src/resources/store-domains';
export { isPublicMarketingHost } from '../../../src/resources/store-domains';

const currentHostname = () => typeof window === 'undefined' ? '' : window.location.hostname;
// En local/hosts desconocidos no saltar a producción ni aceptar destinos arbitrarios.
export const customerAccessUrl = (hostname = currentHostname()) => domainEnvironment(hostname)?.store ?? '/';
export const marketingAccessUrl = (hostname = currentHostname()) => domainEnvironment(hostname)?.marketing ?? '/';

export type PublicMarketingPage = 'home' | 'plans' | 'contact' | 'info-faqs' | 'prereservation' | 'legal-notice' | 'privacy' | 'not-found';

export const publicPrereservationCode = (pathname: string) => {
  const match = /^\/prerreserva\/(starter|professional|enterprise)$/.exec(pathname);
  return match?.[1] as 'starter' | 'professional' | 'enterprise' | undefined;
};

export const publicMarketingPage = (pathname: string): PublicMarketingPage => {
  if (pathname === '/') return 'home';
  if (pathname === '/planes') return 'plans';
  if (pathname === '/contacto') return 'contact';
  if (pathname === '/info-faqs') return 'info-faqs';
  if (publicPrereservationCode(pathname)) return 'prereservation';
  if (pathname === '/aviso-legal') return 'legal-notice';
  if (pathname === '/privacidad') return 'privacy';
  return 'not-found';
};
