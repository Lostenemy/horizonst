import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const distributorBrochureFilename = 'HorizonST_Frio.pdf';
const moduleDirectory = path.dirname(fileURLToPath(import.meta.url));
export const distributorBrochurePath = path.resolve(moduleDirectory, '..', '..', 'resources', 'distributors', distributorBrochureFilename);
