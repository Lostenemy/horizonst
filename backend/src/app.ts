import express from 'express';
import cors from 'cors';
import path from 'path';
import fs from 'fs';
import { json, urlencoded } from 'express';
import authRouter from './routes/auth';
import userRouter from './routes/users';
import gatewayRouter from './routes/gateways';
import deviceRouter from './routes/devices';
import placeRouter from './routes/places';
import categoryRouter from './routes/categories';
import alarmRouter from './routes/alarms';
import messageRouter from './routes/messages';
import contactRouter from './routes/contact';
import rfidRouter from './routes/rfid';

const BASE_PATH = process.env.COCKPIT_BASE_PATH?.replace(/\/+$/, '') || '';
const app = express();
const router = express.Router();

app.set('trust proxy', 1);

const healthHandler = (_req: express.Request, res: express.Response) => {
  res.status(200).json({ status: 'ok' });
};

router.use(cors());
router.use(json({ limit: '10mb' }));
router.use(urlencoded({ extended: true, limit: '10mb' }));

router.use('/api/auth', authRouter);
router.use('/api/users', userRouter);
router.use('/api/gateways', gatewayRouter);
router.use('/api/devices', deviceRouter);
router.use('/api/places', placeRouter);
router.use('/api/categories', categoryRouter);
router.use('/api/alarms', alarmRouter);
router.use('/api/messages', messageRouter);
router.use('/api/contact', contactRouter);
router.use('/api/rfid', rfidRouter);

const publicDir = path.join(__dirname, '..', 'public');
const baseHref = `${BASE_PATH || ''}/`.replace(/\/+$/, '/');
const templateBasePath = BASE_PATH || '';

const renderHtml = (fileName: string) => {
  const filePath = path.join(publicDir, fileName);
  try {
    const template = fs.readFileSync(filePath, 'utf-8');
    return template
      .replace(/__BASE_HREF__/g, baseHref)
      .replace(/__BASE_PATH__/g, templateBasePath);
  } catch (error) {
    console.error(`Failed to render template ${fileName}`, error);
    return null;
  }
};

app.get('/health', healthHandler);
router.get('/health', healthHandler);

router.get('/', (_req, res) => {
  const html = renderHtml('index.html');
  if (!html) {
    res.status(500).send('Unable to load page');
    return;
  }
  res.type('html').send(html);
});

const htmlPages = [
  'dashboard.html',
  'devices.html',
  'device-create.html',
  'gateways.html',
  'history.html',
  'alarms.html',
  'users.html',
  'categories.html',
  'messages.html',
  'rfid.html'
];

htmlPages.forEach((page) => {
  router.get(`/${page}`, (_req, res) => {
    const html = renderHtml(page);
    if (!html) {
      res.status(500).send('Unable to load page');
      return;
    }
    res.type('html').send(html);
  });
});

router.use(express.static(publicDir));

app.use(BASE_PATH || '/', router);

export default app;
