export const coverageLabel = (squareMeters: number | null | undefined) => squareMeters && squareMeters > 0
  ? `Cobertura aproximada: hasta ${new Intl.NumberFormat('es-ES').format(squareMeters)} m²`
  : null;
