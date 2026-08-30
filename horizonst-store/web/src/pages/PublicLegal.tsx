import type { PublicMarketingPage } from '../lib/domains';
import { commercialCompany } from '../../../src/resources/commercial-company';

const legalIdentity = `${commercialCompany.legalName}, empresario autónomo, NIF ${commercialCompany.taxId}, con domicilio en ${commercialCompany.addressLines.join(', ')}`;

const content = {
  'legal-notice': {
    eyebrow: 'Información legal',
    title: 'Aviso legal',
    sections: [
      { title: 'Titularidad', text: `El titular del sitio es ${legalIdentity}. Contacto: ${commercialCompany.email}.` },
      { title: 'Uso del sitio', text: 'El contenido del sitio tiene carácter informativo y no constituye una oferta contractual. Las condiciones comerciales se facilitan en la zona privada o mediante propuesta personalizada.' },
      { title: 'Propiedad intelectual', text: 'Los textos, marcas, diseños y demás contenidos del sitio están protegidos por la normativa aplicable y no pueden reutilizarse sin autorización.' },
      { title: 'Limitación de responsabilidad', text: `${commercialCompany.legalName} procura mantener la información actualizada, pero no garantiza la ausencia de errores ni responde por decisiones tomadas exclusivamente a partir de contenidos informativos.` },
      { title: 'Legislación aplicable', text: 'La relación con el sitio se rige por la legislación española aplicable.' }
    ]
  },
  privacy: {
    eyebrow: 'Protección de datos',
    title: 'Política de privacidad',
    sections: [
      { title: 'Responsable del tratamiento', text: `${legalIdentity}. Para privacidad y ejercicio de derechos: ${commercialCompany.email}.` },
      { title: 'Datos tratados y finalidades', text: 'Tratamos nombre, empresa, email, teléfono y mensaje de los formularios para gestionar solicitudes de demo, entregar o gestionar solicitudes de la guía APPCC y realizar seguimiento comercial relacionado con la solicitud. No solicitamos categorías especiales de datos.' },
      { title: 'Base jurídica y conservación', text: 'La base jurídica es el consentimiento del interesado y, cuando corresponda, la aplicación de medidas precontractuales. Conservamos los datos durante el tiempo necesario para atender la solicitud y cumplir obligaciones legales.' },
      { title: 'Destinatarios', text: 'No comunicamos datos a terceros salvo obligación legal o proveedores necesarios para prestar el servicio, sujetos a las garantías aplicables.' },
      { title: 'Derechos', text: `Puedes ejercer acceso, rectificación, supresión, oposición, limitación y portabilidad escribiendo a ${commercialCompany.email}. También puedes reclamar ante la Agencia Española de Protección de Datos.` }
    ]
  }
} as const;

export default function PublicLegal({ page }: { page: Extract<PublicMarketingPage, 'legal-notice' | 'privacy'> }) {
  const legal = content[page];
  return (
    <main className="public-landing legal-page">
      <header className="lp-nav">
        <a className="lp-brand" href="/">HorizonST</a>
        <a href="/">Volver a inicio</a>
      </header>
      <section className="lp-section">
        <p className="eyebrow">{legal.eyebrow}</p>
        <h1>{legal.title}</h1>
        <div className="lp-grid one">
          {legal.sections.map((section) => <article className="lp-card" key={section.title}><h2>{section.title}</h2><p>{section.text}</p></article>)}
        </div>
      </section>
    </main>
  );
}
