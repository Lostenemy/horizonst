import { PublicFooter, PublicNav } from '../components/PublicMarketingShell';
import { CommercialVisual } from '../components/CommercialVisual';
import ConsultationForm, { consultationPurpose } from '../components/ConsultationForm';
import { useEffect, useState } from 'react';
export default function PublicContact() {
  const [purpose, setPurpose] = useState(() => consultationPurpose(typeof window === 'undefined' || typeof document === 'undefined' || document.getElementById('root')?.dataset.prerendered === 'true' ? '' : window.location.search));
  useEffect(() => { setPurpose(consultationPurpose(window.location.search)); }, []);
  return <main className="public-landing commercial-v3"><PublicNav /><section className="lp-section">
    <h1>Hablemos de tu instalación o de una colaboración</h1><p>Selecciona el motivo de tu consulta y cuéntanos lo necesario para empezar. Puedes contactar sin crear una cuenta.</p>
    <div className="commercial-contact-grid"><div>
      <h2>{purpose === 'colaboracion' ? 'Cuéntanos cómo trabajáis con vuestros clientes' : purpose === 'presupuesto' ? 'Solicita un presupuesto para tu instalación' : 'Cuéntanos cómo son tus cámaras'}</h2>
      <p>{purpose === 'colaboracion' ? 'Indica vuestra actividad y qué tipo de empresas asesoráis, instaláis o proyectáis. No necesitas tramitar un alta para solicitar información.' : 'Indica cuántas cámaras utilizáis, cuántos trabajadores acceden y cómo controláis sus tiempos. Si aún no tienes todos los datos, podemos empezar con la información disponible.'}</p>
      <ConsultationForm initialPurpose={purpose} onPurposeChange={setPurpose} />
    </div><CommercialVisual scene="installation" /></div></section><PublicFooter /></main>;
}
