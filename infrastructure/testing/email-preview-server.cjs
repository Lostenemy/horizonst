'use strict';
// Local, read-only preview of explicitly generated fictitious artifacts. No arbitrary files.
const http=require('node:http'),fs=require('node:fs'),path=require('node:path');
const root=path.resolve(process.argv[2] || '');
if(!process.argv[2] || !fs.existsSync(path.join(root,'index.html')))throw new Error('Generated preview directory required');
const allowed=/^(?:index\.html|(?:production|staging)-(?:verification|quote|order|commercial)\.(?:html|eml|txt))$/;
const server=http.createServer((req,res)=>{
  const name=new URL(req.url,'http://127.0.0.1').pathname.slice(1) || 'index.html';
  if(req.method!=='GET' || !allowed.test(name)){res.writeHead(404);res.end();return;}
  const file=path.join(root,name);
  fs.readFile(file,(error,data)=>{
    if(error){res.writeHead(404);res.end();return;}
    res.setHeader('Content-Type',name.endsWith('.html')?'text/html; charset=utf-8':'text/plain; charset=utf-8');
    res.setHeader('Cache-Control','no-store');
    res.setHeader('Content-Security-Policy',"default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'");
    res.end(data);
  });
});
server.listen(0,'127.0.0.1',()=>console.log(`Fictitious email previews: http://127.0.0.1:${server.address().port}/`));
let stopping=false;
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{if(!stopping){stopping=true;server.close();}});
