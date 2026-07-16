export const isPublicMarketingHost = (hostname: string) => {
  const host = hostname.toLowerCase();
  return host === 'horizonst.com.es' || host === 'www.horizonst.com.es';
};

export const customerAccessUrl = 'https://tienda.horizonst.com.es';

export type PublicMarketingPage = 'home' | 'plans' | 'info-faqs' | 'prereservation' | 'legal-notice' | 'privacy' | 'not-found';

export const publicPrereservationCode = (pathname: string) => {
  const match = /^\/prerreserva\/(starter|professional|enterprise)$/.exec(pathname);
  return match?.[1] as 'starter' | 'professional' | 'enterprise' | undefined;
};

export const publicMarketingPage = (pathname: string): PublicMarketingPage => {
  if (pathname === '/') return 'home';
  if (pathname === '/planes') return 'plans';
  if (pathname === '/info-faqs') return 'info-faqs';
  if (publicPrereservationCode(pathname)) return 'prereservation';
  if (pathname === '/aviso-legal') return 'legal-notice';
  if (pathname === '/privacidad') return 'privacy';
  return 'not-found';
};
