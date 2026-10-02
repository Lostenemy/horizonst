import assert from 'node:assert/strict';
import { readFileSync,readdirSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
class Element {
 children:Element[]=[];attrs:Record<string,string>={};dataset:Record<string,string>={};listeners:Record<string,Function>={};id='';href='';textContent='';className='';focused=false;
 appendChild(e:Element){this.children.push(e);}append(...e:Element[]){this.children.push(...e);}replaceChildren(){this.children=[];}setAttribute(k:string,v:string){this.attrs[k]=v;}getAttribute(k:string){return this.attrs[k];}addEventListener(k:string,f:Function){this.listeners[k]=f;}focus(){this.focused=true;}
}
for(const role of ['ADMIN','hardware_superadmin','hardware_technician','hardware_readonly','USER'])test(`shared navigation role ${role}, current section, toggle and Escape`,()=>{
 const nav=new Element();const context=vm.createContext({document:{getElementById:()=>nav,createElement:()=>new Element()},window:{location:{pathname:'/administracion/devices.html'}}});
 vm.runInContext(readFileSync('public/js/navigation.js','utf8').replace(/^export /gm,''),context);vm.runInContext(`renderNavigation({role:'${role}'})`,context);
 const [button,links]=nav.children;const global=['ADMIN','hardware_superadmin'].includes(role);
 assert.equal(links.children.some(a=>a.href==='users.html'),global);assert.equal(links.children.some(a=>a.href==='companies.html'),role!=='USER');
 assert.equal(links.children.filter(a=>a.attrs['aria-current']==='page').length,1);assert.equal(links.children.find(a=>a.attrs['aria-current'])!.href,'devices.html');
 button.listeners.click();assert.equal(button.attrs['aria-expanded'],'true');nav.listeners.keydown({key:'Escape'});assert.equal(button.attrs['aria-expanded'],'false');assert(button.focused);
 assert.equal(links.children.at(-1)!.id,'logoutLink');
});
test('every effective authenticated page uses shared navigation; login/redirect remain separate',()=>{
 for(const file of readdirSync('public').filter(file=>file.endsWith('.html')&&!['index.html','device-create.html'].includes(file))){const source=readFileSync('public/'+file,'utf8');assert.match(source,/id="adminNavigation"/);assert.doesNotMatch(source,/<nav>\s*<a/);}
 assert.match(readFileSync('public/js/ui.js','utf8'),/renderNavigation\(getCurrentUser\(\)\)/);
});
