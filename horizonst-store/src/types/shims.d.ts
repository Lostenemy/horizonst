declare const process: any;
declare const console: any;
declare const Buffer: any;
declare module 'node:fs/promises' { export const readdir: any; export const readFile: any; export const mkdir: any; export const writeFile: any; }
declare module 'node:path' { const path: any; export default path; }
declare module 'node:url' { export const fileURLToPath: any; }
declare module 'node:crypto' { export const randomUUID: any; export const randomBytes: any; export const scrypt: any; export const timingSafeEqual: any; export const createHmac: any; export const createHash: any; }
declare module 'node:net' { export const connect: any; export type Socket = any; }
declare module 'node:tls' { export const connect: any; export type TLSSocket = any; }
declare module 'node:util' { export const promisify: any; }
declare module 'cors';
declare module 'express' { export const Router: any; const express: any; export default express; export type RequestHandler = any; }
declare module 'helmet';
declare module 'pg';
declare module 'dotenv';
declare module 'zod' { export const z: any; export class ZodError { flatten(): any; } }
