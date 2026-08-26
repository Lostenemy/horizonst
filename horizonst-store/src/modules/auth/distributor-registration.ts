import { z } from 'zod';
import { distributorCountries, isValidDistributorLocation, regionsForCountry } from '../../resources/distributor-geography.js';
import { distributorPhonePattern, distributorRegistrationFields, distributorTaxIdPattern, isHttpUrl, spanishPostalCodePattern } from '../../resources/distributor-registration-rules.js';

const required = (label: string, max: number) => z.string({ required_error: `${label} es obligatorio.` }).trim().min(1, `${label} es obligatorio.`).max(max, `${label} es demasiado largo.`);
const optional = (schema: any) => z.preprocess((value) => typeof value === 'string' && value.trim() === '' ? undefined : value, schema.optional());

const countryCodes = new Set(distributorCountries.map((country) => country.code));

export const registerDistributorSchema = z.object({
  fullName: required('El nombre completo', 200),
  email: z.string({ required_error: 'El correo electrónico es obligatorio.' }).trim().email('Introduce un correo válido. Ejemplo: nombre@empresa.es').max(320, 'El correo electrónico es demasiado largo.'),
  phone: required('El teléfono', 50).regex(distributorPhonePattern, 'Introduce un teléfono válido. Ejemplo: +34 612 345 678'),
  password: z.string({ required_error: 'La contraseña es obligatoria.' }).min(10, 'La contraseña debe tener al menos 10 caracteres.').max(200, 'La contraseña es demasiado larga.'),
  company_name: required('La razón social', 200),
  tax_id: required('El CIF/NIF/NIE', 80).transform((value: string) => value.toUpperCase()).refine((value: string) => distributorTaxIdPattern.test(value), 'Introduce un CIF, NIF o NIE válido. Ejemplo: B12345678'),
  billing_address: required('La dirección fiscal', 500),
  city: required('La localidad', 120),
  country: required('El país', 2).refine((value: string) => countryCodes.has(value), 'Selecciona un país válido.'),
  region: required('La comunidad autónoma', 120),
  province: required('La provincia', 120),
  postal_code: required('El código postal', 5).regex(spanishPostalCodePattern, 'Introduce un código postal válido. Ejemplo: 30001'),
  website: optional(z.string().trim().max(300, 'La web es demasiado larga.').refine(isHttpUrl, 'Introduce una URL completa. Ejemplo: https://empresa.es')),
  contact_person: optional(z.string().trim().max(200, 'La persona de contacto es demasiado larga.'))
}).strict().superRefine((input: any, context: any) => {
  if (!regionsForCountry(input.country).some((region) => region.name === input.region)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['region'], message: 'Selecciona una comunidad autónoma válida.' });
    return;
  }
  if (!isValidDistributorLocation(input.country, input.region, input.province)) {
    context.addIssue({ code: z.ZodIssueCode.custom, path: ['province'], message: 'Selecciona una provincia válida para la comunidad autónoma indicada.' });
  }
});

export { distributorRegistrationFields };
