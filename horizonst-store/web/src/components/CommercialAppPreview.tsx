import { useState } from 'react';

const views = [
  { id: 'resumen', label: 'Resumen', caption: 'Consulta el resumen de actividad y el estado mostrado por el sistema.' },
  { id: 'presencia', label: 'Presencia y tiempos', caption: 'Revisa quién figura dentro, su tiempo de permanencia y el acumulado de la jornada. Las seis horas son una referencia visual: no generan bloqueos ni alarmas.' },
  { id: 'alarmas', label: 'Alarmas', caption: 'Consulta los avisos y alarmas registrados, con severidad, mensaje y fecha.' },
  { id: 'informes', label: 'Informes', caption: 'Consulta las opciones de informes y filtros por periodo.' }
] as const;

export function CommercialAppPreview() {
  const [selected, setSelected] = useState<(typeof views)[number]>(views[0]);
  const [expanded, setExpanded] = useState(false);
  const image = `/images/panel-publico/${selected.id}.png`;
  return <section className="lp-section commercial-app-preview" id="aplicacion" aria-labelledby="app-preview-title">
    <h2 id="app-preview-title">Así ves la información en la aplicación</h2>
    <p>Recreaciones ilustrativas generadas con IA a partir de la interfaz, con datos ficticios. Son imágenes estáticas, no datos en directo. Los tiempos son ejemplos, no una regla general.</p>
    <div className="commercial-app-controls" role="group" aria-label="Seleccionar vista de la aplicación">
      {views.map(view => <button type="button" key={view.id} aria-pressed={selected.id === view.id} onClick={() => { setSelected(view); setExpanded(false); }}>{view.label}</button>)}
    </div>
    <figure><div className={expanded ? 'commercial-app-image expanded' : 'commercial-app-image'} tabIndex={expanded ? 0 : undefined} aria-label={expanded ? 'Imagen ampliada; desplázate horizontalmente para ver el contenido' : undefined}>
      <img src={image} alt={`Recreación ilustrativa de la vista ${selected.label}, con datos ficticios`} />
    </div><figcaption>{selected.caption}</figcaption></figure>
    <button type="button" aria-pressed={expanded} onClick={() => setExpanded(!expanded)}>{expanded ? 'Reducir imagen' : 'Ampliar imagen'}</button>
    {expanded && <p>Usa la barra de desplazamiento o las flechas del teclado sobre la imagen para recorrerla.</p>}
  </section>;
}
