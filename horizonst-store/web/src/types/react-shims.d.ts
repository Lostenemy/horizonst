declare module 'react' { export function useEffect(cb: () => void | (() => void), deps?: unknown[]): void; export function useState<T>(initial: T): [T, (value: T) => void]; }
declare module 'react-dom/client' { export function createRoot(element: Element): { render(node: unknown): void }; }
declare namespace JSX { interface IntrinsicElements { [elemName: string]: any } }
declare module '*.css';
declare module 'react/jsx-runtime' { export const jsx: any; export const jsxs: any; export const Fragment: any; }
