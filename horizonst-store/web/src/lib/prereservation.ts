export const prereservationCodes = ['starter', 'professional', 'enterprise'] as const;
export type PrereservationCode = typeof prereservationCodes[number];

export const isPrereservationCode = (value: string | null): value is PrereservationCode =>
  value != null && (prereservationCodes as readonly string[]).includes(value);

export const prereservationSessionKey = (code: PrereservationCode) => `horizonst_prereservation_access:${code}`;

export const prereservationEndLabel = (endAt: string) =>
  new Intl.DateTimeFormat('es-ES', { dateStyle: 'long', timeZone: 'Europe/Madrid' }).format(new Date(endAt));

export type PrereservationCampaign = {
  campaign: string;
  endAt: string;
  active: boolean;
  codes: PrereservationCode[];
};

export type PrereservationOffer = {
  available: boolean;
  code: PrereservationCode;
  contactRequired?: boolean;
  hardware?: { name: string; priceCents: number; discountCents: number; taxCents: number; taxRate: string | number; coverageSquareMeters: number | null };
  webPlan?: { name: string; priceCents: number; discountCents: number; taxCents: number; taxRate: string | number };
  subtotalCents?: number;
  discountCents?: number;
  discountedSubtotalCents?: number;
  taxCents?: number;
  totalCents?: number;
};
