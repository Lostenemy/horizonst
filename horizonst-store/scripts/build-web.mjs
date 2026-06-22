import { cp, mkdir } from 'node:fs/promises';
import path from 'node:path';

const outDir = path.resolve('web/dist');
await mkdir(outDir, { recursive: true });
await cp('web/index.html', path.join(outDir, 'index.html'));
await cp('web/src/styles.css', path.join(outDir, 'styles.css'));
await cp('web/src/app.js', path.join(outDir, 'app.js'));
console.log('Built web assets into web/dist');
