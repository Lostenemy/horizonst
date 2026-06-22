declare const process: any;
declare const console: any;
declare module 'node:fs/promises' { export const readdir: any; export const readFile: any; }
declare module 'node:path' { const path: any; export default path; }
declare module 'node:url' { export const fileURLToPath: any; }
declare module 'cors';
declare module 'express';
declare module 'helmet';
declare module 'pg';
declare module 'bcryptjs';
declare module 'dotenv';
declare module 'zod' { export const z: any; export class ZodError { flatten(): any; } }
