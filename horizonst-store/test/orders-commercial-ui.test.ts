import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path: string) => readFile(new URL(path, import.meta.url), 'utf8');
const [orders, quotes, layout, adminOrder, styles, commercialLayout] = await Promise.all([
  read('../web/src/pages/Orders.tsx'),
  read('../web/src/pages/Quotes.tsx'),
  read('../web/src/components/Layout.tsx'),
  read('../web/src/pages/admin/AdminOrderDetail.tsx'),
  read('../web/src/styles.css'),
  read('../web/src/commercial-layout.css')
]);

assert.match(orders, /commercial-documents-page/, 'orders reuse the shared commercial document visual shell');
assert.match(quotes, /commercial-documents-page/, 'quotes use the same shared visual shell');
assert.match(layout, /location\.pathname === '\/orders' \|\| location\.pathname === '\/quotes'/, 'only orders and quotes opt into the wide commercial container');
assert.match(layout, /commercial-wide-container/, 'the shared layout applies the wide variant to commercial document pages');
assert.match(commercialLayout, /\.commercial-wide-container\s*\{\s*max-width:\s*1680px/, 'commercial pages widen the parent container without changing their internal columns');
assert.match(orders, /className="table-wrap"/, 'orders table scrolls inside its own responsive container');
assert.match(orders, /downloadFile\(`\/api\/orders\/\$\{detail\.order\.id\}\/pdf`/, 'delivery note uses authenticated blob download');
assert.match(orders, />Descargar albarán</);
assert.doesNotMatch(orders, /href=\{`\/api\/orders\/.*\/pdf/, 'orders do not expose a direct unauthenticated PDF link');
assert.match(adminOrder, /downloadFile\(`\/api\/admin\/orders\/\$\{id\}\/pdf`/);
assert.match(adminOrder, />Descargar albarán</);
assert.match(styles, /\.commercial-documents-page th\{background:#08233f;color:#fff\}/, 'orders and quotes share strong header contrast');
assert.match(styles, /\.commercial-documents-page \.selected-row\{background:#ccecef;box-shadow:inset 4px 0 #087b86\}/, 'selected rows remain clearly visible');
assert.match(styles, /\.commercial-status\.accepted,\.commercial-status\.completed\{background:#d9f5e8;color:#075b38\}/, 'status badges use accessible state colors');
assert.match(styles, /@media\(max-width:900px\).*\.commercial-documents-page>\.two-columns\{grid-template-columns:1fr\}/, 'commercial pages collapse at tablet width');
assert.match(styles, /@media\(max-width:680px\).*\.commercial-detail button\{width:100%\}/, 'download actions remain usable on mobile');
