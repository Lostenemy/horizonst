// Tipado básico para el cliente digest-fetch usado en el controlador GPIO
// No existe paquete oficial de tipos en npm, por lo que declaramos lo necesario aquí.
declare module 'digest-fetch' {
  export interface DigestClientOptions {
    algorithm?: 'MD5' | 'MD5-sess' | string;
    cnonceSize?: number;
    nc?: number;
    realm?: string;
    digest?: string;
    header?: string;
    basic?: boolean;
    logger?: { log: (...args: any[]) => void } | false;
  }

  export default class DigestClient {
    constructor(username: string, password: string, options?: DigestClientOptions);
    fetch(input: RequestInfo | string, init?: RequestInit): Promise<Response>;
  }
}
