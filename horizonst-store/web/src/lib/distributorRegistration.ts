import { isValidDistributorLocation, provincesForRegion, regionsForCountry } from '../../../src/resources/distributor-geography';
import { distributorEmailPattern, distributorPhonePattern, distributorRegistrationFields, distributorTaxIdPattern, isHttpUrl, requiredDistributorFields, spanishPostalCodePattern, type DistributorRegistrationField } from '../../../src/resources/distributor-registration-rules';
export { distributorCountries } from '../../../src/resources/distributor-geography';

export type DistributorRegistrationValues = Record<DistributorRegistrationField, string>;
export type DistributorFieldErrors = Partial<Record<DistributorRegistrationField, string>>;
export type DistributorLocation = Pick<DistributorRegistrationValues, 'country' | 'region' | 'province'>;

export const emptyDistributorRegistration: DistributorRegistrationValues = Object.fromEntries(distributorRegistrationFields.map((field) => [field, ''])) as DistributorRegistrationValues;

const requiredMessages: Partial<Record<DistributorRegistrationField, string>> = {
  fullName: 'El nombre completo es obligatorio.', email: 'El correo electrónico es obligatorio.', phone: 'El teléfono es obligatorio.', password: 'La contraseña es obligatoria.', company_name: 'La razón social es obligatoria.', tax_id: 'El CIF/NIF/NIE es obligatorio.', billing_address: 'La dirección fiscal es obligatoria.', city: 'La localidad es obligatoria.', country: 'El país es obligatorio.', region: 'La comunidad autónoma es obligatoria.', province: 'La provincia es obligatoria.', postal_code: 'El código postal es obligatorio.'
};

export const distributorRegions = regionsForCountry;
export const distributorProvinces = provincesForRegion;
export const changeDistributorCountry = (country: string): DistributorLocation => ({ country, region: '', province: '' });
export const changeDistributorRegion = (location: DistributorLocation, region: string): DistributorLocation => ({ ...location, region, province: '' });

export function readDistributorRegistration(formData: FormData): DistributorRegistrationValues {
  const values = { ...emptyDistributorRegistration };
  for (const field of distributorRegistrationFields) values[field] = String(formData.get(field) ?? '').trim();
  values.email = values.email.toLowerCase();
  values.tax_id = values.tax_id.toUpperCase();
  return values;
}

export function validateDistributorRegistration(values: DistributorRegistrationValues): DistributorFieldErrors {
  const errors: DistributorFieldErrors = {};
  for (const field of requiredDistributorFields) if (!values[field]) errors[field] = requiredMessages[field];
  if (values.email && !distributorEmailPattern.test(values.email)) errors.email = 'Introduce un correo válido. Ejemplo: nombre@empresa.es';
  if (values.phone && !distributorPhonePattern.test(values.phone)) errors.phone = 'Introduce un teléfono válido. Ejemplo: +34 612 345 678';
  if (values.password && values.password.length < 10) errors.password = 'La contraseña debe tener al menos 10 caracteres.';
  if (values.tax_id && !distributorTaxIdPattern.test(values.tax_id)) errors.tax_id = 'Introduce un CIF, NIF o NIE válido. Ejemplo: B12345678';
  if (values.postal_code && !spanishPostalCodePattern.test(values.postal_code)) errors.postal_code = 'Introduce un código postal válido. Ejemplo: 30001';
  if (values.website && !isHttpUrl(values.website)) errors.website = 'Introduce una URL completa. Ejemplo: https://empresa.es';
  if (values.country && values.region && !regionsForCountry(values.country).some((region) => region.name === values.region)) errors.region = 'Selecciona una comunidad autónoma válida.';
  if (values.country && values.region && values.province && !isValidDistributorLocation(values.country, values.region, values.province)) errors.province = 'Selecciona una provincia válida para la comunidad autónoma indicada.';
  return errors;
}

export function distributorFieldErrorsFromApi(details: unknown): DistributorFieldErrors {
  if (!details || typeof details !== 'object' || !('fieldErrors' in details)) return {};
  const fieldErrors = (details as { fieldErrors?: unknown }).fieldErrors;
  if (!fieldErrors || typeof fieldErrors !== 'object') return {};
  const errors: DistributorFieldErrors = {};
  for (const field of distributorRegistrationFields) {
    const messages = (fieldErrors as Record<string, unknown>)[field];
    if (Array.isArray(messages) && typeof messages[0] === 'string') errors[field] = messages[0];
  }
  return errors;
}

export function distributorFormErrorFromApi(details: unknown): string | undefined {
  if (!details || typeof details !== 'object' || !('formErrors' in details)) return undefined;
  const formErrors = (details as { formErrors?: unknown }).formErrors;
  return Array.isArray(formErrors) && typeof formErrors[0] === 'string' ? formErrors[0] : undefined;
}
