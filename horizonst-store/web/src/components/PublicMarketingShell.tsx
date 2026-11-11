import type { ReactNode } from 'react';
import { customerAccessUrl } from '../lib/domains';

export function PublicNav() {
  const pathname = typeof window === 'undefined' ? '/' : window.location.pathname;
  return <nav className="lp-nav" aria-label="Navegación pública">
    <a className="lp-brand" href="/">HorizonST</a>
    <div className="lp-nav-links">{[['/', 'Inicio'], ['/planes', 'Planes'], ['/info-faqs', 'Cómo funciona'], ['/colaboraciones', 'Colaboraciones'], ['/contacto', 'Contacto']].map(([href, label]) =>
      <a key={href} href={href} aria-current={pathname === href || (href === '/colaboraciones' && pathname.startsWith('/colaboraciones/')) ? 'page' : undefined}>{label}</a>)}</div>
    <a className="btn secondary" href={customerAccessUrl()}>Tienda B2B</a>
  </nav>;
}

export function PublicFooter() {
  return <footer className="lp-footer"><p>HorizonST · Control de permanencia y descansos en cámaras congeladoras.</p><nav aria-label="Legal"><a href="/contacto">Contacto</a><a href="/aviso-legal">Aviso legal</a><a href="/privacidad">Privacidad</a></nav></footer>;
}

export function HorneoCase({ approvedMedia }: { approvedMedia?: ReactNode } = {}) {
  return <section className="lp-section lp-success-case" aria-labelledby="horneo-case-title">
    <div><h2 id="horneo-case-title">Caso de éxito</h2><h3>Horneo</h3>
      <p>Horneo lleva varios meses utilizando Horizon Smartracking. La instalación abarca una cámara de aproximadamente 400 m² y permite supervisar la actividad de 10 trabajadores distintos.</p>
      <p>Una referencia de uso real del sistema para conocer cómo puede encajar en una instalación.</p>
      <p className="lp-note-copy">Este caso describe una instalación, no un resultado medido ni una garantía de seguridad.</p>
      <a href="/contacto?motivo=instalacion">Consultar el encaje en mi empresa</a></div>
    <img src="/images/casos-exito/horneo.png" alt="Logotipo de Horneo" width="320" height="320" loading="lazy" decoding="async" />
    {approvedMedia && <div className="lp-case-media">{approvedMedia}</div>}
  </section>;
}
