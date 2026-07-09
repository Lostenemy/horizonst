export const isPublicMarketingHost = (hostname: string) => {
  const host = hostname.toLowerCase();
  return host === 'horizonst.com.es' || host === 'www.horizonst.com.es';
};

export const customerAccessUrl = 'https://tienda.horizonst.com.es';
