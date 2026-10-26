import * as mail from '../src/modules/shared/mail.js';
import {env} from '../src/config/env.js';
import {verifyTransactionalEmails,captureMime,decodeMimeText} from '../integration/email-mime.fixture.mjs';
import {corporateEmail} from '../src/modules/shared/email-template.js';
import assert from 'node:assert/strict';

const originalBase=env.publicBaseUrl;
assert.equal((await verifyTransactionalEmails(mail,env)).length,8);
assert.equal(env.publicBaseUrl,originalBase);
assert.throws(()=>corporateEmail({title:'fixture',paragraphs:[],button:{label:'fixture',url:'javascript:alert(1)'}}),/invalid_email_url/);
{
  const content=mail.buildEmailVerificationEmail({email:'fixture@example.invalid',fullName:'María 👷 & <ficticia> '.repeat(100),
    verificationUrl:'https://preview.example.invalid/verify-email?token=FICTIONAL-'+ 'x'.repeat(1800)+'&test=yes',expiresInSeconds:3600});
  content.attachments=[{filename:'fixture.pdf',contentType:'application/pdf',content:Buffer.from('%PDF-1.7\n\u0000fictitious\n')}];
  const mime=await captureMime(mail.SmtpClient,content);
  assert.equal(decodeMimeText(mime,'html'),content.html);
  assert.equal(decodeMimeText(mime,'plain'),content.text.replace(/\r?\n/g,'\r\n'));
  assert.ok(mime.split('\r\n').every(line=>Buffer.byteLength(line)<=998));
  assert.match(decodeMimeText(mime,'html'),/>Verificar mi cuenta<\/a>/);
  const attachment=/Content-Disposition: attachment; filename="fixture.pdf"\r\n\r\n([\s\S]*?)(?=\r\n--)/.exec(mime);
  assert.ok(attachment);assert.deepEqual(Buffer.from(attachment[1].replace(/\s/g,''),'base64'),content.attachments[0].content);
}
