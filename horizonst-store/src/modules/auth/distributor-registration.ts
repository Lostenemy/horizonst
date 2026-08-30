import { z } from 'zod';
import { distributorCountries, distributorCountry, isValidDistributorProvince, isValidDistributorRegion } from '../../resources/distributor-geography.js';
import { distributorPhonePattern, distributorRegistrationFields, normalizeWebsiteUrl } from '../../resources/distributor-registration-rules.js';

const required = (label: string, max: number) => z.string({ required_error: `${label} es obligatorio.` }).trim().min(1, `${label} es obligatorio.`).max(max, `${label} es demasiado largo.`);
const optional = (schema: any) => z.preprocess((value) => typeof value === 'string' && value.trim() === '' ? undefined : value, schema.optional());
const optionalWebsite = z.preprocess((value) => {
  if (typeof value !== 'string' || !value.trim()) return undefined;
  return normalizeWebsiteUrl(value) ?? value.trim();
}, z.string().max(300, 'La web es demasiado larga.').refine((value) => normalizeWebsiteUrl(value) !== undefined, 'Introduce una web válida. Ejemplo: empresa.es').optional());

const countryCodes = new Set(distributorCountries.map((country) => country.code));

export const registerDistributorSchema = z.object({
  fullName: required('El nombre completo', 200),
  email: z.string({ required_error: 'El correo electrónico es obligatorio.' }).trim().email('Introduce un correo válido. Ejemplo: nombre@empresa.es').max(320, 'El correo electrónico es demasiado largo.'),
  phone: required('El teléfono', 50).regex(distributorPhonePattern, 'Introduce un teléfono internacional válido. Ejemplo: +44 20 7946 0958'),
  password: z.string({ required_error: 'La contraseña es obligatoria.' }).min(10, 'La contraseña debe tener al menos 10 caracteres.').max(200, 'La contraseña es demasiado larga.'),
  company_name: required('La razón social', 200),
  tax_id: required('El identificador fiscal / VAT', 80).transform((value: string) => value.toUpperCase()),
  billing_address: required('La dirección fiscal', 500),
  city: required('La localidad', 120),
  country: required('El país', 2).refine((value: string) => countryCodes.has(value), 'Selecciona un país válido.'),
  region: z.string().trim().max(120, 'La región es demasiado larga.').default(''),
  province: z.string().trim().max(120, 'La división administrativa es demasiado larga.').default(''),
  postal_code: required('El código postal', 20),
  website: optionalWebsite,
  contact_person: optional(z.string().trim().max(200, 'La persona de contacto es demasiado larga.'))
}).strict().superRefine((input: any, context: any) => {
  const country = distributorCountry(input.country);
  if (!country) return;
  if (!isValidDistributorRegion(input.country, input.region)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['region'], message: country.regionRequired ? `${country.regionLabel} es obligatorio o no es válido.` : `${country.regionLabel} no es válido.` });
  if (!isValidDistributorProvince(input.country, input.region, input.province)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['province'], message: country.provinceRequired ? `${country.provinceLabel} es obligatorio o no es válido.` : `${country.provinceLabel} no es válido.` });
  if (country.taxIdPattern && !country.taxIdPattern.test(input.tax_id)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['tax_id'], message: `Introduce un identificador fiscal válido. Ejemplo: ${country.taxIdExample}` });
  if (!country.postalCodePattern.test(input.postal_code)) context.addIssue({ code: z.ZodIssueCode.custom, path: ['postal_code'], message: `Introduce un código postal válido. Ejemplo: ${country.postalCodeExample}` });
});

export { distributorRegistrationFields };
