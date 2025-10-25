declare module 'jsonwebtoken' {
  export type Secret =
    | string
    | Buffer
    | { key: string | Buffer; passphrase: string };

  export interface SignOptions {
    algorithm?: string;
    expiresIn?: string | number;
    notBefore?: string | number;
    audience?: string | string[];
    subject?: string;
    issuer?: string;
    jwtid?: string;
    mutatePayload?: boolean;
    noTimestamp?: boolean;
    header?: Record<string, unknown>;
    keyid?: string;
  }

  export interface JwtPayload {
    [key: string]: unknown;
  }

  export function sign(
    payload: string | Buffer | object,
    secretOrPrivateKey: Secret,
    options?: SignOptions
  ): string;

  export function verify(
    token: string,
    secretOrPublicKey: Secret
  ): string | JwtPayload;

  const jwt: {
    sign: typeof sign;
    verify: typeof verify;
  };

  export default jwt;
}
