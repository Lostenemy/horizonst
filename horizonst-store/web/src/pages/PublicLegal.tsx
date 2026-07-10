import type { PublicMarketingPage } from '../lib/domains';

const content = {
  'legal-notice': {
    eyebrow: 'Información legal',
    title: 'Aviso legal',
    sections: [
      { title: 'Titularidad', text: 'HorizonST ofrece información comercial sobre soluciones de monitorización y trazabilidad para operaciones profesionales.' },
      { title: 'Uso del sitio', text: 'El contenido del sitio tiene carácter informativo y no constituye una oferta contractual. Las condiciones comerciales se facilitan en la zona privada o mediante propuesta personalizada.' },
      { title: 'Contacto', text: 'Para consultas relacionadas con este sitio puedes escribir a comercial@horizonst.com.es.' }
    ]
  },
  privacy: {
    eyebrow: 'Protección de datos',
    title: 'Política de privacidad',
    sections: [
      { title: 'Datos tratados', text: 'Los formularios públicos solicitan los datos necesarios para atender una solicitud de demo o enviar la guía APPCC: nombre, empresa, email, teléfono y mensaje opcional.' },
      { title: 'Finalidad', text: 'Los datos se utilizan para gestionar la solicitud comercial y dar seguimiento al interés manifestado. No se emplean para fines incompatibles con esa solicitud.' },
      { title: 'Derechos', text: 'Puedes solicitar acceso, rectificación, supresión u otros derechos de protección de datos contactando con comercial@horizonst.com.es.' }
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
