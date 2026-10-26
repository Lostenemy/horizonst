import assert from 'node:assert/strict';
import net from 'node:net';
import {randomBytes} from 'node:crypto';

export function decodeMimeText(mime,subtype) {
  const part=new RegExp(`Content-Type: text/${subtype}; charset="utf-8"\r\nContent-Transfer-Encoding: base64\r\n\r\n([\\s\\S]*?)(?=\r\n--)`).exec(mime);
  assert.ok(part,`missing ${subtype} UTF-8 base64 part`);
  const lines=part[1].split('\r\n');assert.ok(lines.every(line=>line.length<=76));
  return Buffer.from(part[1].replace(/\s/g,''),'base64').toString('utf8');
}

// Real local TCP SMTP peer, fictitious credentials and envelopes only. No mail leaves loopback.
export async function captureMime(SmtpClient,content) {
  let mime;
  const sockets=new Set();
  const server=net.createServer(socket=>{
    sockets.add(socket);socket.on('close',()=>sockets.delete(socket));socket.on('error',()=>{});
    socket.write('220 local fictitious SMTP\r\n');let buffer='',data=false,auth=0;
    socket.on('data',chunk=>{
      buffer+=chunk.toString('utf8');
      if(data) {
        const end=buffer.indexOf('\r\n.\r\n');if(end<0)return;
        mime=buffer.slice(0,end).replace(/(^|\r\n)\.\./g,'$1.');buffer=buffer.slice(end+5);data=false;
        socket.write('250 accepted locally only\r\n');return;
      }
      while(buffer.includes('\r\n')) {
        const end=buffer.indexOf('\r\n'),line=buffer.slice(0,end);buffer=buffer.slice(end+2);
        if(auth){socket.write(auth===1?'334 Password\r\n':'235 ok\r\n');auth=auth===1?2:0;}
        else if(line.startsWith('EHLO'))socket.write('250 local\r\n');
        else if(line==='AUTH LOGIN'){auth=1;socket.write('334 User\r\n');}
        else if(line==='DATA'){data=true;socket.write('354 continue\r\n');}
        else if(line==='QUIT')socket.write('221 bye\r\n');
        else socket.write('250 ok\r\n');
      }
    });
  });
  server.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
  const client=new SmtpClient({enabled:true,host:'127.0.0.1',port:server.address().port,secure:false,
    user:'fixture',password:randomBytes(32).toString('hex'),from:'sender@example.invalid',
    ehloDomain:'example.invalid',tlsRejectUnauthorized:true,commercialTo:'commercial@example.invalid',appccGuideUrl:''});
  try {await client.connect();await client.sendMail(content.to,content.subject,content.text,content.html,content.attachments,content.replyTo);await client.close();return mime;}
  finally {client.abort();for(const socket of sockets)socket.destroy();await new Promise(r=>server.close(r));}
}

export async function verifyTransactionalEmails(mail,env) {
  const previous=env.publicBaseUrl,previousRecipient=env.mail.commercialTo,artifacts=[];
  try {
    env.mail.commercialTo='commercial@example.invalid';
    for(const [environment,base] of [['production','https://tienda.horizonst.es'],['staging','https://tienda.horizonst.com.es']]) {
      env.publicBaseUrl=base;
      const quote={id:'11111111-1111-4111-8111-111111111111',quote_number:'Q-FICTICIO-001',total_cents:12100,email:'customer@example.invalid',full_name:'María Ficticia',role:'customer'};
      const order={id:'22222222-2222-4222-8222-222222222222',order_number:'ORD-FICTICIO-001'};
      const verificationUrl=base+'/verify-email?token=FICTIONAL-NOT-VALID&purpose=preview';
      const messages=[['verification',mail.buildEmailVerificationEmail({email:quote.email,fullName:quote.full_name,verificationUrl,expiresInSeconds:86400}),verificationUrl,'Verificar mi cuenta'],
        ['quote',mail.buildQuoteAvailableEmail({quote}),base+'/quotes','Consultar presupuesto'],
        ['order',mail.buildOrderConfirmationEmail({quote,order}),base+'/orders','Consultar pedidos'],
        ['commercial',mail.buildQuoteAcceptedCommercialEmail({quote,order}),base+'/admin/orders/'+order.id,'Consultar pedido']];
      for(const [name,content,url,label] of messages) {
        const mime=await captureMime(mail.SmtpClient,content),html=decodeMimeText(mime,'html'),text=decodeMimeText(mime,'plain');
        assert.equal(html,content.html.replace(/\r?\n/g,'\r\n'));assert.equal(text,content.text.replace(/\r?\n/g,'\r\n'));
        assert.ok(mime.split('\r\n').every(line=>Buffer.byteLength(line,'utf8')<=998),'bounded physical MIME lines');
        for(const color of ['#08233f','#edf4f6','#ffffff','#008d99'])assert.ok(html.includes(color));
        assert.match(html,/HorizonST/);assert.match(html,/generado automáticamente/);
        assert.doesNotMatch(html,/<script|<link|<style|<img/i);
        assert.ok(html.includes('>'+label+'</a>'));assert.ok(html.includes('white-space:nowrap'));
        assert.ok(html.includes('href="'+url.replace(/&/g,'&amp;')+'"'));assert.ok(text.includes(url));
        assert.doesNotMatch(html,/cue[\s\u00ad\u200b\u200c\u200d\ufeff]+nta/);
        if(name!=='verification'){assert.ok(html.includes(quote.quote_number));assert.ok(text.includes(quote.quote_number));}
        if(name==='order'||name==='commercial'){assert.ok(html.includes(order.order_number));assert.ok(text.includes(order.order_number));}
        if(name==='verification'){assert.match(html,/24 horas/);assert.match(text,/24 horas/);}
        artifacts.push({name:environment+'-'+name,mime,html,text});
      }
      const injected={...quote,full_name:'<img src=x onerror="alert(1)"> & Ana',quote_number:'Q-<script>"&',role:'<svg/onload=1>'};
      for(const content of [mail.buildQuoteAvailableEmail({quote:injected}),mail.buildOrderConfirmationEmail({quote:injected,order}),mail.buildQuoteAcceptedCommercialEmail({quote:injected,order}),
        mail.buildEmailVerificationEmail({email:quote.email,fullName:injected.full_name,verificationUrl,expiresInSeconds:86400})]) {
        assert.doesNotMatch(content.html,/<img|<script|<svg|href="[^"]*"\s*on/i);
        assert.ok(content.html.includes('&lt;img'));assert.ok(content.html.includes('&amp;'));
      }
    }
    return artifacts;
  } finally {env.publicBaseUrl=previous;env.mail.commercialTo=previousRecipient;}
}
