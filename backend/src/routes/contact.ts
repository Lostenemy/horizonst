import { Router } from 'express';
import { config } from '../config';
import { sendMail } from '../services/mail';

const router = Router();

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_MESSAGE_LENGTH = 4000;

const sanitize = (value: unknown): string => {
  if (typeof value !== 'string') {
    return '';
  }
  return value.trim();
};

router.post('/', async (req, res) => {
  if (!config.mail.enabled) {
    return res.status(503).json({ message: 'El servicio de correo no está disponible.' });
  }

  const name = sanitize(req.body?.name);
  const company = sanitize(req.body?.company);
  const email = sanitize(req.body?.email).toLowerCase();
  const message = sanitize(req.body?.message);

  if (!name || !company || !email || !message) {
    return res.status(400).json({ message: 'Todos los campos son obligatorios.' });
  }

  if (!EMAIL_REGEX.test(email)) {
    return res.status(400).json({ message: 'Introduce un email válido.' });
  }

  const safeMessage = message.slice(0, MAX_MESSAGE_LENGTH);
  const recipients = config.mail.contactRecipients;
  if (!recipients.length) {
    return res.status(503).json({ message: 'No hay destinatarios configurados para el formulario.' });
  }

  const subjectContext = company || name;
  const subject = `Solicitud demo · ${subjectContext}`;
  const bodyLines = [
    'Nueva solicitud recibida desde el formulario público de HorizonST.',
    '',
    `Nombre: ${name}`,
    `Empresa: ${company}`,
    `Email: ${email}`,
    '',
    'Mensaje:',
    safeMessage
  ];

  try {
    await sendMail({
      to: recipients,
      subject,
      text: bodyLines.join('\n'),
      replyTo: email
    });
    return res.status(202).json({ message: 'Solicitud enviada correctamente.' });
  } catch (error) {
    console.error('Error enviando solicitud de contacto', error);
    return res.status(502).json({ message: 'No se pudo enviar la solicitud. Inténtalo más tarde.' });
  }
});

export default router;
