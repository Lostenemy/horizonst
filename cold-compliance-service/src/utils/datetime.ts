const MADRID_TIMEZONE = 'Europe/Madrid';

const dateTimeFormatterMadrid = new Intl.DateTimeFormat('es-ES', {
  timeZone: MADRID_TIMEZONE,
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hour12: false
});

export function formatDateTimeMadrid(value: string | Date | null | undefined, fallback = '-'): string {
  if (!value) return fallback;

  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;

  return dateTimeFormatterMadrid.format(date);
}

export { MADRID_TIMEZONE };
