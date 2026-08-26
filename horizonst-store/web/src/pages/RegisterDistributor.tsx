import { FormEvent, ReactNode, useState } from 'react';
import ErrorMessage from '../components/ErrorMessage';
import { ApiError, postJson } from '../lib/api';
import { changeDistributorCountry, changeDistributorRegion, distributorCountries, distributorFieldErrorsFromApi, distributorFormErrorFromApi, distributorProvinces, distributorRegions, readDistributorRegistration, validateDistributorRegistration, type DistributorFieldErrors, type DistributorLocation, type DistributorRegistrationValues } from '../lib/distributorRegistration';

type RegisterDistributorResponse = { verificationToken?: string; welcomeEmailSent?: boolean };

function FormField({ name, label, required = false, hint, error, children }: { name: keyof DistributorRegistrationValues; label: string; required?: boolean; hint?: string; error?: string; children: ReactNode }) {
  return <div className="form-field"><label htmlFor={name}>{label}{required && <span className="required-mark" aria-hidden="true"> *</span>}</label>{children}{hint && <span className="field-hint" id={`${name}-hint`}>{hint}</span>}{error && <span className="field-error" id={`${name}-error`} role="alert">{error}</span>}</div>;
}

export default function RegisterDistributor() {
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<DistributorFieldErrors>({});
  const [location, setLocation] = useState<DistributorLocation>({ country: '', region: '', province: '' });
  const [submitting, setSubmitting] = useState(false);

  const describedBy = (name: keyof DistributorRegistrationValues, hasHint = false) => [hasHint ? `${name}-hint` : '', fieldErrors[name] ? `${name}-error` : ''].filter(Boolean).join(' ') || undefined;
  const validationProps = (name: keyof DistributorRegistrationValues, hasHint = false) => ({ id: name, name, 'aria-invalid': fieldErrors[name] ? true : undefined, 'aria-describedby': describedBy(name, hasHint), onChange: () => setFieldErrors((current) => ({ ...current, [name]: undefined })) });
  const focusFirstError = (form: HTMLFormElement, errors: DistributorFieldErrors) => { const first = Object.keys(errors)[0]; if (first) (form.elements.namedItem(first) as HTMLElement | null)?.focus(); };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const values = readDistributorRegistration(new FormData(form));
    const clientErrors = validateDistributorRegistration(values);
    setMessage(''); setError(''); setFieldErrors(clientErrors);
    if (Object.keys(clientErrors).length > 0) { setError('Revisa los campos indicados antes de continuar.'); focusFirstError(form, clientErrors); return; }
    setSubmitting(true);
    try {
      const data = await postJson<RegisterDistributorResponse>('/api/auth/register-distributor', values);
      setMessage(`${data.welcomeEmailSent ? 'Te hemos enviado el correo de bienvenida con el dossier adjunto.' : 'Cuenta creada. Si no recibes el correo, solicita un reenvío desde el acceso.'} La cuenta queda pendiente de verificación y validación.${data.verificationToken ? ` Token dev: ${data.verificationToken}` : ''}`);
      form.reset(); setLocation({ country: '', region: '', province: '' }); setFieldErrors({});
    } catch (caught) {
      if (caught instanceof ApiError) {
        const backendErrors = distributorFieldErrorsFromApi(caught.details);
        if (caught.status === 409) backendErrors.email = 'Ya existe una cuenta con este correo electrónico.';
        setFieldErrors(backendErrors);
        if (Object.keys(backendErrors).length > 0) { setError('Revisa los campos indicados.'); focusFirstError(form, backendErrors); }
        else setError(distributorFormErrorFromApi(caught.details) ?? 'No se pudo completar el alta. Inténtalo de nuevo.');
      } else setError('No se pudo completar el alta. Inténtalo de nuevo.');
    } finally { setSubmitting(false); }
  }

  const changeCountry = (country: string) => { setLocation(changeDistributorCountry(country)); setFieldErrors((current) => ({ ...current, country: undefined, region: undefined, province: undefined })); };
  const changeRegion = (region: string) => { setLocation((current) => changeDistributorRegion(current, region)); setFieldErrors((current) => ({ ...current, region: undefined, province: undefined })); };
  const regions = distributorRegions(location.country);
  const provinces = distributorProvinces(location.country, location.region);

  return (
    <section className="panel distributor-registration">
      <h1>Registro de distribuidor</h1>
      <p className="muted">Los campos marcados con <span aria-hidden="true">*</span> son obligatorios.</p>
      <ErrorMessage message={error} />
      <form className="grid" onSubmit={submit} noValidate>
        <FormField name="fullName" label="Nombre y apellidos" required error={fieldErrors.fullName}><input {...validationProps('fullName')} type="text" autoComplete="name" maxLength={200} required /></FormField>
        <FormField name="email" label="Correo electrónico" required hint="Ejemplo: nombre@empresa.es" error={fieldErrors.email}><input {...validationProps('email', true)} type="email" autoComplete="email" maxLength={320} placeholder="nombre@empresa.es" required /></FormField>
        <FormField name="phone" label="Teléfono" required hint="Ejemplo: +34 612 345 678" error={fieldErrors.phone}><input {...validationProps('phone', true)} type="tel" autoComplete="tel" maxLength={50} placeholder="+34 612 345 678" required /></FormField>
        <FormField name="password" label="Contraseña" required hint="Mínimo 10 caracteres." error={fieldErrors.password}><input {...validationProps('password', true)} type="password" autoComplete="new-password" minLength={10} maxLength={200} required /></FormField>
        <FormField name="company_name" label="Razón social" required error={fieldErrors.company_name}><input {...validationProps('company_name')} type="text" autoComplete="organization" maxLength={200} required /></FormField>
        <FormField name="tax_id" label="CIF / NIF / NIE" required hint="Ejemplo: B12345678" error={fieldErrors.tax_id}><input {...validationProps('tax_id', true)} type="text" autoCapitalize="characters" maxLength={80} placeholder="B12345678" required /></FormField>
        <FormField name="billing_address" label="Dirección fiscal" required error={fieldErrors.billing_address}><input {...validationProps('billing_address')} type="text" autoComplete="street-address" maxLength={500} required /></FormField>
        <FormField name="city" label="Localidad" required error={fieldErrors.city}><input {...validationProps('city')} type="text" autoComplete="address-level2" maxLength={120} required /></FormField>
        <FormField name="country" label="País" required error={fieldErrors.country}><select {...validationProps('country')} value={location.country} autoComplete="country" required onChange={(event) => changeCountry(event.target.value)}><option value="">Selecciona un país</option>{distributorCountries.map((country) => <option key={country.code} value={country.code}>{country.name}</option>)}</select></FormField>
        <FormField name="region" label="Región / Comunidad Autónoma" required error={fieldErrors.region}><select {...validationProps('region')} value={location.region} autoComplete="address-level1" required disabled={!location.country} onChange={(event) => changeRegion(event.target.value)}><option value="">Selecciona una comunidad autónoma</option>{regions.map((region) => <option key={region.code} value={region.name}>{region.name}</option>)}</select></FormField>
        <FormField name="province" label="Provincia" required error={fieldErrors.province}><select {...validationProps('province')} value={location.province} required disabled={!location.region} onChange={(event) => { setLocation((current) => ({ ...current, province: event.target.value })); setFieldErrors((current) => ({ ...current, province: undefined })); }}><option value="">Selecciona una provincia</option>{provinces.map((province) => <option key={province.code} value={province.name}>{province.name}</option>)}</select></FormField>
        <FormField name="postal_code" label="Código postal" required hint="Ejemplo: 30001" error={fieldErrors.postal_code}><input {...validationProps('postal_code', true)} type="text" inputMode="numeric" autoComplete="postal-code" maxLength={5} placeholder="30001" required /></FormField>
        <FormField name="website" label="Sitio web" hint="Opcional. Ejemplo: https://empresa.es" error={fieldErrors.website}><input {...validationProps('website', true)} type="url" autoComplete="url" maxLength={300} placeholder="https://empresa.es" /></FormField>
        <FormField name="contact_person" label="Persona de contacto" hint="Opcional, si es distinta de la persona solicitante." error={fieldErrors.contact_person}><input {...validationProps('contact_person', true)} type="text" maxLength={200} /></FormField>
        <button type="submit" disabled={submitting}>{submitting ? 'Enviando solicitud…' : 'Solicitar alta'}</button>
      </form>
      {message && <p className="success" role="status">{message}</p>}
    </section>
  );
}
