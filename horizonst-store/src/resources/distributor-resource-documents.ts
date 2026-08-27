import path from 'node:path';
import { env } from '../config/env.js';
import { distributorBrochurePath } from './distributor-brochure.js';

export const distributorResourceCategories = ['commercial', 'technical', 'pricing', 'legal', 'training', 'other'] as const;
export const distributorResourceVisibilities = ['global', 'targeted'] as const;
export const distributorResourceMaxBytes = 20 * 1024 * 1024;
export const distributorResourceStorageRoot = () => path.resolve(env.documentsPath, 'distributor-resources');

export const resolveDistributorResourcePath = (document: { storage_kind: string; storage_key: string }) => {
  if (document.storage_kind === 'bundled') {
    if (document.storage_key !== 'distributors/HorizonST_Frio.pdf') throw Object.assign(new Error('Invalid bundled resource'), { status: 404 });
    return distributorBrochurePath;
  }
  if (document.storage_kind !== 'uploaded') throw Object.assign(new Error('Invalid resource storage'), { status: 404 });
  const root = distributorResourceStorageRoot();
  const filePath = path.resolve(root, document.storage_key);
  if (!filePath.startsWith(root + path.sep)) throw Object.assign(new Error('Invalid resource path'), { status: 404 });
  return filePath;
};

export const validateDistributorResourcePdf = (file: { buffer: Buffer; originalFilename: string; mimeType: string }) => {
  if (path.extname(file.originalFilename).toLowerCase() !== '.pdf' || file.mimeType !== 'application/pdf' || file.buffer.subarray(0, 4).toString() !== '%PDF') {
    throw Object.assign(new Error('Solo se admiten archivos PDF válidos.'), { status: 400 });
  }
  if (file.buffer.length > distributorResourceMaxBytes) throw Object.assign(new Error('El archivo supera el límite de 20 MB.'), { status: 413 });
};
