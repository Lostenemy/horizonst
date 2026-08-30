import { distributorCountry, isValidDistributorProvince, isValidDistributorRegion, provincesForRegion, regionsForCountry } from '../../../src/resources/distributor-geography';
import { distributorEmailPattern, distributorPhonePattern, distributorRegistrationFields, normalizeWebsiteUrl, requiredDistributorFields, type DistributorRegistrationField } from '../../../src/resources/distributor-registration-rules';
export { distributorCountries } from '../../../src/resources/distributor-geography';

export type DistributorRegistrationValues = Record<DistributorRegistrationField, string>;
export type DistributorFieldErrors = Partial<Record<DistributorRegistrationField, string>>;
export type DistributorLocation = Pick<DistributorRegistrationValues, 'country' | 'region' | 'province'>;

export const emptyDistributorRegistration: DistributorRegistrationValues = Object.fromEntries(distributorRegistrationFields.map((field) => [field, ''])) as DistributorRegistrationValues;

const requiredMessages: Partial<Record<DistributorRegistrationField, string>> = {
  fullName: 'El nombre completo es obligatorio.', email: 'El correo electrónico es obligatorio.', phone: 'El teléfono es obligatorio.', password: 'La contraseña es obligatoria.', company_name: 'La razón social es obligatoria.', tax_id: 'El identificador fiscal / VAT es obligatorio.', billing_address: 'La dirección fiscal es obligatoria.', city: 'La localidad es obligatoria.', country: 'El país es obligatorio.', postal_code: 'El código postal es obligatorio.'
};

export const distributorRegions = regionsForCountry;
export const distributorProvinces = provincesForRegion;
export const distributorGeography = distributorCountry;
export const changeDistributorCountry = (country: string): DistributorLocation => ({ country, region: '', province: '' });
export const changeDistributorRegion = (location: DistributorLocation, region: string): DistributorLocation => ({ ...location, region, province: '' });

export function readDistributorRegistration(formData: FormData): DistributorRegistrationValues {
  const values = { ...emptyDistributorRegistration };
  for (const field of distributorRegistrationFields) values[field] = String(formData.get(field) ?? '').trim();
  values.email = values.email.toLowerCase();
  values.tax_id = values.tax_id.toUpperCase();
  if (values.website) values.website = normalizeWebsiteUrl(values.website) ?? values.website;
  return values;
}

export function validateDistributorRegistration(values: DistributorRegistrationValues): DistributorFieldErrors {
  const errors: DistributorFieldErrors = {};
  for (const field of requiredDistributorFields) if (!values[field]) errors[field] = requiredMessages[field];
  if (values.email && !distributorEmailPattern.test(values.email)) errors.email = 'Introduce un correo válido. Ejemplo: nombre@empresa.es';
  if (values.phone && !distributorPhonePattern.test(values.phone)) errors.phone = 'Introduce un teléfono internacional válido. Ejemplo: +44 20 7946 0958';
  if (values.password && values.password.length < 10) errors.password = 'La contraseña debe tener al menos 10 caracteres.';
  const country = distributorCountry(values.country);
  if (values.country && !country) errors.country = 'Selecciona un país válido.';
  if (country) {
    if (country.regionRequired && !values.region) errors.region = `${country.regionLabel} es obligatorio.`;
    else if (!isValidDistributorRegion(values.country, values.region)) errors.region = `Selecciona un valor válido para ${country.regionLabel.toLowerCase()}.`;
    if (country.provinceRequired && !values.province) errors.province = `${country.provinceLabel} es obligatorio.`;
    else if (!isValidDistributorProvince(values.country, values.region, values.province)) errors.province = `Selecciona un valor válido para ${country.provinceLabel.toLowerCase()}.`;
    if (values.tax_id && country.taxIdPattern && !country.taxIdPattern.test(values.tax_id)) errors.tax_id = `Introduce un identificador fiscal válido. Ejemplo: ${country.taxIdExample}`;
    if (values.postal_code && !country.postalCodePattern.test(values.postal_code)) errors.postal_code = `Introduce un código postal válido. Ejemplo: ${country.postalCodeExample}`;
  }
  if (values.website && !normalizeWebsiteUrl(values.website)) errors.website = 'Introduce una web válida. Ejemplo: empresa.es';
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
