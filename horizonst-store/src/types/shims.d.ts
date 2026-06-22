declare const process: any;
declare const console: any;
declare const Buffer: any;
declare module 'node:fs/promises' { export const readdir: any; export const readFile: any; }
declare module 'node:path' { const path: any; export default path; }
declare module 'node:url' { export const fileURLToPath: any; }
declare module 'node:crypto' { export const randomBytes: any; export const scrypt: any; export const timingSafeEqual: any; export const createHmac: any; export const createHash: any; }
declare module 'node:util' { export const promisify: any; }
declare module 'cors';
declare module 'express' { export const Router: any; const express: any; export default express; export type RequestHandler = any; }
declare module 'helmet';
declare module 'pg';
declare module 'dotenv';
declare module 'zod' { export const z: any; export class ZodError { flatten(): any; } }
