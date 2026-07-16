import { z } from 'zod';

export const prereservationCodes = ['starter', 'professional', 'enterprise'] as const;
export const prereservationCodeSchema = z.enum(prereservationCodes);
export type PrereservationCode = typeof prereservationCodes[number];

export const PRERESERVATION_CAMPAIGN = 'prereservation_2026';
export const PUBLIC_PRERESERVATION_SOURCE = 'public_prereservation_2026';
export const PRERESERVATION_END_AT = '2026-09-01T21:59:59.999Z';
export const PRERESERVATION_ACCESS_SECONDS = 30 * 60;
export const PRERESERVATION_DISCOUNT_PERCENT = 5;

export const isPrereservationCampaignActive = (now = Date.now()) => now <= Date.parse(PRERESERVATION_END_AT);

const taxRateBasisPoints = (rate: string | number): number | null => {
  const value = String(rate).trim();
  const match = /^(\d{1,3})(?:\.(\d{1,2}))?$/.exec(value);
  if (!match) return null;
  const basisPoints = Number(match[1]) * 100 + Number((match[2] ?? '').padEnd(2, '0'));
  return basisPoints >= 0 && basisPoints <= 10000 ? basisPoints : null;
};

export type OfferComponent = {
  code: string;
  name: string;
  price_cents: number | null;
  tax_rate: string | number;
  is_active: boolean;
  coverage_square_meters?: number | null;
};

export type CalculatedOffer = {
  available: true;
  code: PrereservationCode;
  hardware: { name: string; priceCents: number; discountCents: number; taxCents: number; taxRate: string | number; coverageSquareMeters: number | null };
  webPlan: { name: string; priceCents: number; discountCents: number; taxCents: number; taxRate: string | number };
  subtotalCents: number;
  discountCents: number;
  discountedSubtotalCents: number;
  taxCents: number;
  totalCents: number;
};

export type UnavailableOffer = { available: false; code: PrereservationCode; contactRequired: true };

export const calculatePrereservationOffer = (
  code: PrereservationCode,
  pack?: OfferComponent,
  webPlan?: OfferComponent
): CalculatedOffer | UnavailableOffer => {
  const packTax = pack ? taxRateBasisPoints(pack.tax_rate) : null;
  const planTax = webPlan ? taxRateBasisPoints(webPlan.tax_rate) : null;
  if (!pack || !webPlan || pack.code !== code || webPlan.code !== code || !pack.is_active || !webPlan.is_active ||
      !Number.isInteger(pack.price_cents) || Number(pack.price_cents) <= 0 ||
      !Number.isInteger(webPlan.price_cents) || Number(webPlan.price_cents) <= 0 ||
      packTax == null || planTax == null) {
    return { available: false, code, contactRequired: true };
  }

  const packPrice = Number(pack.price_cents);
  const planPrice = Number(webPlan.price_cents);
  const subtotalCents = packPrice + planPrice;
  const discountCents = Math.round(subtotalCents * PRERESERVATION_DISCOUNT_PERCENT / 100);
  const hardwareDiscountCents = Math.round(packPrice * PRERESERVATION_DISCOUNT_PERCENT / 100);
  const planDiscountCents = discountCents - hardwareDiscountCents;
  const hardwareTaxCents = Math.round((packPrice - hardwareDiscountCents) * packTax / 10000);
  const planTaxCents = Math.round((planPrice - planDiscountCents) * planTax / 10000);
  const discountedSubtotalCents = subtotalCents - discountCents;
  const taxCents = hardwareTaxCents + planTaxCents;

  return {
    available: true,
    code,
    hardware: { name: pack.name, priceCents: packPrice, discountCents: hardwareDiscountCents, taxCents: hardwareTaxCents, taxRate: pack.tax_rate, coverageSquareMeters: pack.coverage_square_meters ?? null },
    webPlan: { name: webPlan.name, priceCents: planPrice, discountCents: planDiscountCents, taxCents: planTaxCents, taxRate: webPlan.tax_rate },
    subtotalCents,
    discountCents,
    discountedSubtotalCents,
    taxCents,
    totalCents: discountedSubtotalCents + taxCents
  };
};
