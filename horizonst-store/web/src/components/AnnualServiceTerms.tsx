import React from 'react';

export const annualServiceTerms = {
  included: 'La cuota anual incluye únicamente el uso de la aplicación, sus actualizaciones y soporte básico de la aplicación.',
  support: 'El soporte básico cubre consultas por correo e incidencias de funcionamiento de la aplicación.',
  excluded: 'No incluye instalación, mantenimiento de hardware ni otros servicios.',
  renewal: 'La renovación requiere la aceptación previa del cliente.'
} as const;

export const enterpriseTerms = 'Enterprise es un plan completo e independiente: puede contratarse desde cero o como ampliación de un plan existente. No requiere contratar Professional previamente. Las condiciones de ampliación se acuerdan en la propuesta comercial.';

export function AnnualServiceTerms() {
  return <p>{Object.values(annualServiceTerms).join(' ')}</p>;
}
