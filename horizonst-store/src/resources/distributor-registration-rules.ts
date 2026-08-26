export const distributorRegistrationFields = ['fullName', 'email', 'phone', 'password', 'company_name', 'tax_id', 'billing_address', 'city', 'country', 'region', 'province', 'postal_code', 'website', 'contact_person'] as const;
export type DistributorRegistrationField = (typeof distributorRegistrationFields)[number];

export const requiredDistributorFields: DistributorRegistrationField[] = ['fullName', 'email', 'phone', 'password', 'company_name', 'tax_id', 'billing_address', 'city', 'country', 'region', 'province', 'postal_code'];
export const distributorPhonePattern = /^(?:\+34[\s-]?)?[6-9](?:[\s-]?\d){8}$/;
export const distributorTaxIdPattern = /^(?:[XYZ]\d{7}[A-Z]|\d{8}[A-Z]|[ABCDEFGHJNPQRSUVW]\d{7}[0-9A-J])$/i;
export const spanishPostalCodePattern = /^(?:0[1-9]|[1-4]\d|5[0-2])\d{3}$/;
export const distributorEmailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const isHttpUrl = (value: string) => {
  try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; }
};
