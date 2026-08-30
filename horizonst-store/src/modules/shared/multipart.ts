import path from 'node:path';

export type MultipartFile = { buffer: Buffer; originalFilename: string; mimeType: string };
export type MultipartForm = { fields: Record<string, string>; file?: MultipartFile };

export const readMultipartForm = (req: any, maxFileBytes: number): Promise<MultipartForm> => new Promise((resolve, reject) => {
  const contentType = String(req.headers['content-type'] ?? '');
  const match = /boundary=(?:(?:"([^"]+)")|([^;]+))/i.exec(contentType);
  if (!match) { reject(Object.assign(new Error('Multipart boundary missing'), { status: 400 })); return; }
  const chunks: Buffer[] = []; let size = 0; let settled = false;
  const fail = (error: Error) => { if (!settled) { settled = true; reject(error); } };
  req.on('data', (chunk: Buffer) => {
    size += chunk.length;
    if (size > maxFileBytes + 1024 * 1024) fail(Object.assign(new Error('File too large'), { status: 413 }));
    else if (!settled) chunks.push(chunk);
  });
  req.on('end', () => {
    if (settled) return;
    const boundary = `--${match[1] ?? match[2]}`;
    const parts = Buffer.concat(chunks).toString('binary').split(boundary);
    const fields: Record<string, string> = {}; let file: MultipartFile | undefined;
    for (const rawPart of parts) {
      const separator = rawPart.indexOf('\r\n\r\n');
      if (separator < 0) continue;
      const headers = rawPart.slice(0, separator);
      const name = /name="([^"]+)"/i.exec(headers)?.[1];
      if (!name) continue;
      const content = Buffer.from(rawPart.slice(separator + 4).replace(/\r\n--$/, '').replace(/\r\n$/, ''), 'binary');
      const suppliedFilename = /filename="([^"]*)"/i.exec(headers)?.[1];
      if (suppliedFilename !== undefined) {
        const originalFilename = path.basename(suppliedFilename).replace(/[\r\n"\\/]/g, '_').slice(0, 240) || 'documento.pdf';
        file = { buffer: content, originalFilename, mimeType: /content-type:\s*([^\r\n]+)/i.exec(headers)?.[1]?.trim().toLowerCase() ?? '' };
      } else fields[name] = content.toString('utf8').trim();
    }
    settled = true; resolve({ fields, file });
  });
  req.on('error', fail);
});

export const safeDownloadFilename = (filename: string) => path.basename(filename).replace(/[\r\n"\\/]/g, '_').slice(0, 240) || 'documento.pdf';
