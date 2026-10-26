export const corporateMailFooter = 'HorizonST — Este correo ha sido generado automáticamente.';
export const escapeEmailHtml = (value: string) => value.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  .replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Text only at this boundary: callers cannot accidentally interpolate customer HTML.
export function corporateEmail(input: { title: string; paragraphs: string[]; button: { label: string; url: string };
  after?: string[]; showUrl?: boolean }): string {
  const protocol = new URL(input.button.url).protocol;
  if (!['https:', 'http:'].includes(protocol)) throw new Error('invalid_email_url');
  const e = escapeEmailHtml;
  const paragraph = (text: string) => `<p style="margin:0 0 18px;font-size:16px;line-height:1.6;overflow-wrap:anywhere;word-break:break-word">${e(text).replace(/\r?\n/g, '<br>')}</p>`;
  const url = e(input.button.url);
  return [
    '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">',
    `<title>${e(input.title)} · HorizonST</title></head>`,
    '<body style="margin:0;padding:0;background:#edf4f6;color:#08233f;font-family:Arial,Helvetica,sans-serif;-webkit-text-size-adjust:100%">',
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="width:100%;background:#edf4f6"><tr><td align="center" style="padding:24px 12px">',
    '<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-radius:12px;overflow:hidden">',
    '<tr><td bgcolor="#08233f" style="padding:24px;background:#08233f;color:#ffffff;font-size:24px;line-height:1.25;font-weight:bold">HorizonST</td></tr>',
    `<tr><td style="padding:28px 24px"><h1 style="margin:0 0 24px;color:#08233f;font-size:26px;line-height:1.25">${e(input.title)}</h1>`,
    ...input.paragraphs.map(paragraph),
    '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:24px 0"><tr><td bgcolor="#008d99" style="background:#008d99;border-radius:6px;text-align:center">',
    `<a href="${url}" style="display:inline-block;padding:14px 18px;border:1px solid #008d99;border-radius:6px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:16px;line-height:1.25;font-weight:bold;text-decoration:none;white-space:nowrap;word-break:normal;overflow-wrap:normal;hyphens:none">${e(input.button.label)}</a>`,
    '</td></tr></table>',
    ...(input.after ?? []).map(paragraph),
    ...(input.showUrl ? [paragraph('Si el botón no funciona, abre este enlace:'), `<p style="margin:0;font-size:14px;line-height:1.6;overflow-wrap:anywhere;word-break:break-all"><a href="${url}" style="color:#007b86">${url}</a></p>`] : []),
    '</td></tr>',
    `<tr><td style="padding:18px 24px;background:#f5f8f9;color:#536471;font-size:12px;line-height:1.6">${e(corporateMailFooter)}</td></tr>`,
    '</table></td></tr></table></body></html>'
  ].join('\r\n');
}
