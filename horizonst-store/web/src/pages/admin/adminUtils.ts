import { ApiError } from '../../lib/api';
import type { AuditPayload } from './types';

export const apiMessage = (error: unknown): string => error instanceof ApiError ? error.message : 'Error inesperado';

export const payloadSummary = (payload: AuditPayload): string => JSON.stringify(payload ?? {}, null, 2).slice(0, 500);

export const submitParams = (form: HTMLFormElement, fields: string[]): string => {
  const formData = new FormData(form);
  const params = new URLSearchParams();

  for (const field of fields) {
    const value = String(formData.get(field) ?? '').trim();
    if (value) params.set(field, value);
  }

  return params.size ? `?${params.toString()}` : '';
};
