import { useState, type CSSProperties } from 'react';

const scenes = {
  hero: { file: '01-inicio-tag-gateway', alt: 'Ilustración de un trabajador con dispositivo personal visible sobre la ropa y una gateway junto al acceso a una cámara congeladora.' },
  supervision: { file: '02-supervision-aviso', alt: 'Ilustración de un trabajador con dispositivo personal consultando un móvil junto a una cámara congeladora.' },
  food: { file: '04-alimentacion-frio', alt: 'Ilustración de preparación de carga alimentaria con un trabajador y una cámara congeladora.' },
  storage: { file: '05-almacenamiento-especializado', alt: 'Ilustración de una trabajadora con dispositivo personal organizando bandejas junto a una cámara congeladora.' },
  preparation: { file: '06-guia-preparacion', alt: 'Ilustración de un trabajador con dispositivo personal revisando una lista de preparación junto a una cámara congeladora.' },
  installation: { file: '07-contacto-instalacion', alt: 'Ilustración de dos profesionales revisando una instalación con gateway exterior y dispositivo personal.' }
} as const;

const base = '/images/comercial-v3/';
// The supplied mobile crops already retain the devices. Never crop them again.
const imageStyle: CSSProperties = { display: 'block', width: '100%', height: 'auto', objectFit: 'contain' };

export function CommercialVisual({ scene, priority = false }: { scene: keyof typeof scenes; priority?: boolean }) {
  const { file, alt } = scenes[scene];
  const [fallbackFile, setFallbackFile] = useState<string | null>(null);
  const [unavailableFile, setUnavailableFile] = useState<string | null>(null);
  const webpOnly = fallbackFile === file;
  return <figure className="commercial-visual">
    {unavailableFile === file ? <p className="commercial-image-unavailable" role="status">Ilustración no disponible. {alt}</p> : <picture key={`${file}-${webpOnly ? 'webp' : 'primary'}`}>
      {!webpOnly && <source media="(max-width: 640px)" type="image/avif" srcSet={`${base}${file}-movil.avif`} width={720} height={720} />}
      <source media="(max-width: 640px)" type="image/webp" srcSet={`${base}${file}-movil.webp`} width={720} height={720} />
      {!webpOnly && <source type="image/avif" srcSet={`${base}${file}-escritorio.avif`} width={1600} height={900} />}
      <img src={`${base}${file}-escritorio.webp`} alt={alt} width={1600} height={900}
        loading={priority ? 'eager' : 'lazy'} fetchPriority={priority ? 'high' : 'auto'} decoding="async" style={imageStyle}
        onError={() => { if (webpOnly) setUnavailableFile(file); else setFallbackFile(file); }} />
    </picture>}
    <figcaption>Ilustración generada con IA a partir de referencias de los dispositivos. No es una fotografía de una instalación real ni una instrucción de montaje.</figcaption>
  </figure>;
}

export function CommercialOperationDiagram({ compact = false }: { compact?: boolean } = {}) {
  const file = compact ? '03-funcionamiento-compacto' : '03-funcionamiento';
  return <figure className="commercial-operation">
    <picture>
      <source media="(max-width: 640px)" srcSet={`${base}${file}-movil.svg`} width={720} height={compact ? 1440 : 1740} />
      <img src={`${base}${file}-escritorio.svg`} width={1600} height={compact ? 480 : 660} loading="lazy"
        alt={`Esquema conceptual: dispositivo personal; control de presencia, permanencia y descansos; aviso al trabajador por vibración y pitidos; consulta del supervisor.${compact ? '' : ' El SOS alerta al supervisor en la aplicación web.'}`}
        style={imageStyle} />
    </picture>
    <figcaption>Esquema conceptual, no arquitectura técnica. El aviso preventivo personal y la alerta SOS al supervisor son recorridos distintos.</figcaption>
  </figure>;
}
