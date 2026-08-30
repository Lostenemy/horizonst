export const distributorRegistrationFields = ['fullName', 'email', 'phone', 'password', 'company_name', 'tax_id', 'billing_address', 'city', 'country', 'region', 'province', 'postal_code', 'website', 'contact_person'] as const;
export type DistributorRegistrationField = (typeof distributorRegistrationFields)[number];

export const requiredDistributorFields: DistributorRegistrationField[] = ['fullName', 'email', 'phone', 'password', 'company_name', 'tax_id', 'billing_address', 'city', 'country', 'postal_code'];
export const distributorPhonePattern = /^\+?[0-9][0-9\s().-]{6,24}[0-9]$/;
export const distributorEmailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const normalizeWebsiteUrl = (value: string): string | undefined => {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  const candidate = /^https?:\/\//i.test(trimmed) ? trimmed : `https://${trimmed}`;
  try {
    const url = new URL(candidate);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !url.hostname.includes('.') || url.hostname.includes('..')) return undefined;
    if (url.hostname.split('.').some((label) => !label || !/^[a-z0-9-]+$/i.test(label) || label.startsWith('-') || label.endsWith('-'))) return undefined;
    return `${url.origin}${url.pathname === '/' ? '' : url.pathname}${url.search}${url.hash}`;
  } catch { return undefined; }
};
export const isHttpUrl = (value: string) => normalizeWebsiteUrl(value) !== undefined;
