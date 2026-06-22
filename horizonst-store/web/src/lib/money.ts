export const money = (cents?: number | null) => cents == null ? 'Contactar' : new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(Number(cents) / 100);
