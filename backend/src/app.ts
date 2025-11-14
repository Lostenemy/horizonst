import express from 'express';
import cors from 'cors';
import path from 'path';
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

const app = express();

app.set('trust proxy', 1);

app.use(cors());
app.use(json({ limit: '10mb' }));
app.use(urlencoded({ extended: true, limit: '10mb' }));

app.use('/api/auth', authRouter);
app.use('/api/users', userRouter);
app.use('/api/gateways', gatewayRouter);
app.use('/api/devices', deviceRouter);
app.use('/api/places', placeRouter);
app.use('/api/categories', categoryRouter);
app.use('/api/alarms', alarmRouter);
app.use('/api/messages', messageRouter);
app.use('/api/contact', contactRouter);

const publicDir = path.join(__dirname, '..', 'public');
const adminBasePath = '/administracion';
app.use(adminBasePath, express.static(publicDir));

app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok' });
});

app.get(adminBasePath, (_req, res) => {
  res.sendFile(path.join(publicDir, 'index.html'));
});

app.get('/', (_req, res) => {
  res.redirect(adminBasePath);
});

export default app;
