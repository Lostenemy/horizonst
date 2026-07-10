export const isPublicMarketingHost = (hostname: string) => {
  const host = hostname.toLowerCase();
  return host === 'horizonst.com.es' || host === 'www.horizonst.com.es';
};

export const customerAccessUrl = 'https://tienda.horizonst.com.es';

export type PublicMarketingPage = 'landing' | 'legal-notice' | 'privacy';

export const publicMarketingPage = (pathname: string): PublicMarketingPage => {
  if (pathname === '/aviso-legal') return 'legal-notice';
  if (pathname === '/privacidad') return 'privacy';
  return 'landing';
};
