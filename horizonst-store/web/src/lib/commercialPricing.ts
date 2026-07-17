import type { Pack, SaasPlan } from './types';

const hasPositiveIntegerPrice = (value: number | null | undefined) => Number.isInteger(value) && Number(value) > 0;
const hasValidTaxRate = (value: string | number) => Number.isFinite(Number(value)) && Number(value) >= 0 && Number(value) <= 100;

export const canAutoPriceSaasPlan = (plan: Pick<SaasPlan, 'annual_price_cents' | 'tax_rate' | 'is_active' | 'is_enterprise'>) =>
  plan.is_active && !plan.is_enterprise && hasPositiveIntegerPrice(plan.annual_price_cents) && hasValidTaxRate(plan.tax_rate);

export const canAutoPricePack = (pack: Pick<Pack, 'price_cents' | 'tax_rate' | 'is_active'>) =>
  pack.is_active && hasPositiveIntegerPrice(pack.price_cents) && hasValidTaxRate(pack.tax_rate);
