import axios, { AxiosError } from 'axios';
import express from 'express';
import session from 'express-session';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFile } from 'node:fs/promises';

import { logger } from './logger.js';
import { authenticateUser, createUser, deleteUser, ensureDefaultAdmin, listUsers, updateUser } from './authStore.js';
import { deleteCard, deleteWorker, listCards, listWorkers, upsertCard, upsertWorker, updateCardState } from './dataStore.js';
import { initDatabase } from './db.js';
import { ReaderGpoController } from './gpoController.js';
import type { AccessDecision, AccessEvaluationResult, SimulationRequest } from './types.js';

export interface WebInterfaceConfig {
  enabled: boolean;
  port: number;
  basePath: string;
  sessionSecret: string;
  username: string;
  password: string;
  historySize: number;
}

export interface EcoordinaConfig {
  url: string;
  user: string;
  token: string;
  action: string;
  actionType: string;
  instance: string;
  inputFormat: string;
  outputFormat: string;
  timeoutMs: number;
}

export interface HistoryEvent extends AccessEvaluationResult {
  cardId: string;
  mac: string;
  timestamp: string;
  source: 'mqtt' | 'web';
}

export interface WebInterfaceController {
  recordEvent: (event: HistoryEvent) => void;
  close: () => Promise<void>;
}

interface StartWebInterfaceOptions {
  config: WebInterfaceConfig;
  ecoordinaDefaults: EcoordinaConfig;
  simulateScan: (input: SimulationRequest) => Promise<AccessEvaluationResult>;
  gpoController: ReaderGpoController | null;
}

const normalizeMacForDisplay = (mac: string): string => mac.trim().toLowerCase();

const buildHistoryRecorder = (history: HistoryEvent[], limit: number) => {
  return (event: HistoryEvent): void => {
    const normalizedEvent: HistoryEvent = {
      ...event,
      mac: normalizeMacForDisplay(event.mac)
    };

    history.unshift(normalizedEvent);
    if (history.length > limit) {
      history.length = limit;
    }
  };
};

export const startWebInterface = async ({
  config,
  ecoordinaDefaults,
  simulateScan,
  gpoController
}: StartWebInterfaceOptions): Promise<WebInterfaceController | null> => {
  if (!config.enabled) {
    return null;
  }

  await initDatabase();
  await ensureDefaultAdmin({ username: config.username, password: config.password, role: 'admin' });

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', 1);

  app.get('/health', (_req, res) => {
    res.json({ status: 'ok' });
  });

  const basePath = config.basePath;
  const history: HistoryEvent[] = [];
  const recordEvent = buildHistoryRecorder(history, config.historySize);

  const router = express.Router();

  router.use(express.json({ limit: '1mb' }));

  router.use(
    session({
      secret: config.sessionSecret,
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: false,
        path: basePath === '/' ? '/' : `${basePath}`
      }
    })
  );

  const ensureAuthenticated: express.RequestHandler = (req, res, next) => {
    if (req.session?.authenticated) {
      next();
      return;
    }

    res.status(401).json({ error: 'UNAUTHENTICATED' });
  };

  const ensureAdmin: express.RequestHandler = (req, res, next) => {
    if (req.session?.authenticated && req.session.role === 'admin') {
      next();
      return;
    }

    res.status(403).json({ error: 'FORBIDDEN' });
  };

  const asTrimmedString = (value: unknown): string => {
    return typeof value === 'string' ? value.trim() : '';
  };

  const pickStringOrDefault = (candidate: unknown, fallback: string): string => {
    const parsed = asTrimmedString(candidate);
    return parsed || fallback;
  };

  const toWorkerPayload = (payload: any) => {
    const dni = asTrimmedString(payload?.dni).toUpperCase();
    const nombre = asTrimmedString(payload?.nombre);
    const apellidos = asTrimmedString(payload?.apellidos);
    const empresa = asTrimmedString(payload?.empresa);
    const cif = asTrimmedString(payload?.cif);
    const centro = asTrimmedString(payload?.centro).toUpperCase();
    const email = asTrimmedString(payload?.email) || null;
    const activo = payload?.activo !== undefined ? Boolean(payload?.activo) : true;

    return { dni, nombre, apellidos, empresa, cif, centro, email, activo } as const;
  };

  const toCardPayload = (payload: any) => {
    const idTarjeta = asTrimmedString(payload?.idTarjeta).toUpperCase();
    const dni = asTrimmedString(payload?.dni).toUpperCase();
    const centro = asTrimmedString(payload?.centro).toUpperCase();
    const estado = (asTrimmedString(payload?.estado) || 'activa').toLowerCase();
    const notas = asTrimmedString(payload?.notas) || null;

    return { idTarjeta, dni, centro, estado, notas } as const;
  };

  router.post('/api/login', async (req, res) => {
    const { username, password } = req.body ?? {};

    if (typeof username !== 'string' || typeof password !== 'string') {
      res.status(400).json({ error: 'INVALID_CREDENTIALS' });
      return;
    }

    const user = await authenticateUser(username, password);
    if (!user) {
      logger.warn({ username }, 'Failed login attempt to RFID test interface');
      res.status(401).json({ error: 'INVALID_CREDENTIALS' });
      return;
    }

    if (req.session) {
      req.session.authenticated = true;
      req.session.username = user.username;
      req.session.role = user.role;
    }

    res.json({ authenticated: true, username: user.username, role: user.role });
  });

  router.post('/api/logout', ensureAuthenticated, (req, res) => {
    if (req.session) {
      req.session.destroy((error) => {
        if (error) {
          logger.error({ err: error }, 'Failed to destroy session on logout');
        }
      });
    }

    res.json({ authenticated: false });
  });

  router.get('/api/session', (req, res) => {
    res.json({
      authenticated: Boolean(req.session?.authenticated),
      username: req.session?.username ?? null,
      role: req.session?.role ?? null
    });
  });

  router.get('/api/auth/users', ensureAuthenticated, ensureAdmin, async (_req, res) => {
    const users = await listUsers();
    res.json({ users });
  });

  router.post('/api/auth/users', ensureAuthenticated, ensureAdmin, async (req, res) => {
    const { username, password, role, active = true } = req.body ?? {};

    if (typeof username !== 'string' || username.trim().length < 3) {
      res.status(400).json({ error: 'INVALID_USERNAME' });
      return;
    }

    if (typeof password !== 'string' || password.trim().length < 4) {
      res.status(400).json({ error: 'INVALID_PASSWORD' });
      return;
    }

    if (role !== 'admin' && role !== 'user') {
      res.status(400).json({ error: 'INVALID_ROLE' });
      return;
    }

    try {
      const user = await createUser(username.trim(), password.trim(), role, Boolean(active));
      res.status(201).json({ user });
    } catch (error) {
      const err = error as Error;
      if (err.message === 'USERNAME_EXISTS') {
        res.status(409).json({ error: 'USERNAME_EXISTS' });
        return;
      }

      logger.error({ err }, 'Failed to create app user');
      res.status(500).json({ error: 'USER_CREATION_FAILED' });
    }
  });

  router.patch('/api/auth/users/:username', ensureAuthenticated, ensureAdmin, async (req, res) => {
    const { username } = req.params;
    const { password, role, active } = req.body ?? {};

    const updates: { password?: string; role?: 'admin' | 'user'; active?: boolean } = {};

    if (password !== undefined) {
      if (typeof password !== 'string' || password.trim().length < 4) {
        res.status(400).json({ error: 'INVALID_PASSWORD' });
        return;
      }
      updates.password = password.trim();
    }

    if (role !== undefined) {
      if (role !== 'admin' && role !== 'user') {
        res.status(400).json({ error: 'INVALID_ROLE' });
        return;
      }
      updates.role = role;
    }

    if (active !== undefined) {
      updates.active = Boolean(active);
    }

    try {
      const user = await updateUser(username, updates);
      if (req.session?.username === username && updates.role) {
        req.session.role = updates.role;
      }
      res.json({ user });
    } catch (error) {
      const err = error as Error;
      if (err.message === 'NOT_FOUND') {
        res.status(404).json({ error: 'NOT_FOUND' });
        return;
      }
      if (err.message === 'LAST_ADMIN') {
        res.status(409).json({ error: 'LAST_ADMIN' });
        return;
      }
      logger.error({ err }, 'Failed to update app user');
      res.status(500).json({ error: 'USER_UPDATE_FAILED' });
    }
  });

  router.delete('/api/auth/users/:username', ensureAuthenticated, ensureAdmin, async (req, res) => {
    const { username } = req.params;

    if (req.session?.username === username) {
      res.status(400).json({ error: 'CANNOT_DELETE_SELF' });
      return;
    }

    try {
      await deleteUser(username);
      res.status(204).send();
    } catch (error) {
      const err = error as Error;
      if (err.message === 'NOT_FOUND') {
        res.status(404).json({ error: 'NOT_FOUND' });
        return;
      }
      if (err.message === 'LAST_ADMIN') {
        res.status(409).json({ error: 'LAST_ADMIN' });
        return;
      }
      logger.error({ err }, 'Failed to delete app user');
      res.status(500).json({ error: 'USER_DELETE_FAILED' });
    }
  });

  router.get('/api/workers', ensureAuthenticated, async (_req, res) => {
    const workers = await listWorkers();
    res.json({ workers });
  });

  router.post('/api/workers', ensureAuthenticated, async (req, res) => {
    const payload = toWorkerPayload(req.body);
    if (!payload.dni || !payload.nombre || !payload.apellidos || !payload.empresa || !payload.cif || !payload.centro) {
      res.status(400).json({ error: 'INVALID_WORKER' });
      return;
    }

    try {
      const worker = await upsertWorker({ ...payload, creadoEn: new Date().toISOString() });
      res.status(201).json({ worker });
    } catch (error) {
      logger.error({ err: error }, 'Failed to upsert worker');
      res.status(500).json({ error: 'WORKER_WRITE_FAILED' });
    }
  });

  router.patch('/api/workers/:dni', ensureAuthenticated, async (req, res) => {
    const payload = toWorkerPayload({ ...req.body, dni: req.params.dni });
    if (!payload.dni || !payload.nombre || !payload.apellidos || !payload.empresa || !payload.cif || !payload.centro) {
      res.status(400).json({ error: 'INVALID_WORKER' });
      return;
    }

    try {
      const worker = await upsertWorker({ ...payload, creadoEn: new Date().toISOString() });
      res.json({ worker });
    } catch (error) {
      logger.error({ err: error }, 'Failed to update worker');
      res.status(500).json({ error: 'WORKER_WRITE_FAILED' });
    }
  });

  router.delete('/api/workers/:dni', ensureAuthenticated, async (req, res) => {
    const dni = asTrimmedString(req.params.dni).toUpperCase();
    if (!dni) {
      res.status(400).json({ error: 'INVALID_WORKER' });
      return;
    }

    try {
      await deleteWorker(dni);
      res.status(204).send();
    } catch (error) {
      logger.error({ err: error }, 'Failed to delete worker');
      res.status(500).json({ error: 'WORKER_DELETE_FAILED' });
    }
  });

  router.get('/api/cards', ensureAuthenticated, async (_req, res) => {
    const cards = await listCards();
    res.json({ cards });
  });

  router.post('/api/cards', ensureAuthenticated, async (req, res) => {
    const payload = toCardPayload(req.body);
    if (!payload.idTarjeta || !payload.dni) {
      res.status(400).json({ error: 'INVALID_CARD' });
      return;
    }

    try {
      const card = await upsertCard({ ...payload, asignadaEn: new Date().toISOString() });
      res.status(201).json({ card });
    } catch (error) {
      logger.error({ err: error }, 'Failed to upsert card');
      res.status(500).json({ error: 'CARD_WRITE_FAILED' });
    }
  });

  router.patch('/api/cards/:idTarjeta', ensureAuthenticated, async (req, res) => {
    const idTarjeta = asTrimmedString(req.params.idTarjeta).toUpperCase();
    if (!idTarjeta) {
      res.status(400).json({ error: 'INVALID_CARD' });
      return;
    }

    const estado = asTrimmedString(req.body?.estado);
    if (!estado) {
      res.status(400).json({ error: 'INVALID_CARD' });
      return;
    }

    try {
      const card = await updateCardState(idTarjeta, estado);
      res.json({ card });
    } catch (error) {
      logger.error({ err: error }, 'Failed to update card');
      res.status(500).json({ error: 'CARD_WRITE_FAILED' });
    }
  });

  router.delete('/api/cards/:idTarjeta', ensureAuthenticated, async (req, res) => {
    const idTarjeta = asTrimmedString(req.params.idTarjeta).toUpperCase();
    if (!idTarjeta) {
      res.status(400).json({ error: 'INVALID_CARD' });
      return;
    }

    try {
      await deleteCard(idTarjeta);
      res.status(204).send();
    } catch (error) {
      logger.error({ err: error }, 'Failed to delete card');
      res.status(500).json({ error: 'CARD_DELETE_FAILED' });
    }
  });

  router.get('/api/ecoordina/defaults', ensureAuthenticated, (_req, res) => {
    res.json({ defaults: ecoordinaDefaults });
  });

  router.post('/api/ecoordina/test', ensureAuthenticated, async (req, res) => {
    const {
      url,
      user,
      token,
      action,
      actionType,
      instance,
      inputFormat,
      outputFormat,
      centro_cod: centroCodRaw,
      empresa_cif: empresaCifRaw,
      trabajador_dni: trabajadorDniRaw
    } = req.body ?? {};

    const targetUrl = pickStringOrDefault(url, ecoordinaDefaults.url);
    const authUser = pickStringOrDefault(user, ecoordinaDefaults.user);
    const authToken = pickStringOrDefault(token, ecoordinaDefaults.token);
    const selectedAction = pickStringOrDefault(action, ecoordinaDefaults.action);
    const selectedActionType = pickStringOrDefault(actionType, ecoordinaDefaults.actionType);
    const selectedInstance = pickStringOrDefault(instance, ecoordinaDefaults.instance);
    const selectedInput = pickStringOrDefault(inputFormat, ecoordinaDefaults.inputFormat);
    const selectedOutput = pickStringOrDefault(outputFormat, ecoordinaDefaults.outputFormat);

    const centroCod = pickStringOrDefault(centroCodRaw, '').toUpperCase();
    const empresaCif = pickStringOrDefault(empresaCifRaw, '').toUpperCase();
    const trabajadorDni = pickStringOrDefault(trabajadorDniRaw, '').toUpperCase();
    if (!targetUrl || !authUser || !authToken || !centroCod || !empresaCif || !trabajadorDni) {
      res.status(400).json({
        error: 'MISSING_FIELDS',
        required: [
          'url',
          'user',
          'token',
          'centro_cod',
          'empresa_cif',
          'trabajador_dni'
        ]
      });
      return;
    }

    const payloadData = {
      data: {
        centro_cod: centroCod,
        empresa_cif: empresaCif,
        trabajador_dni: trabajadorDni
      }
    };

    const payload = {
      user: authUser,
      token: authToken,
      instance: selectedInstance,
      in: selectedInput,
      out: selectedOutput,
      action_type: selectedActionType,
      action: selectedAction,
      data: payloadData
    };

    const formPayload = new URLSearchParams();
    formPayload.append('user', authUser);
    formPayload.append('token', authToken);
    formPayload.append('instance', selectedInstance);
    formPayload.append('in', selectedInput);
    formPayload.append('out', selectedOutput);
    formPayload.append('action_type', selectedActionType);
    formPayload.append('action', selectedAction);
    const dataField = JSON.stringify(payloadData).replace(/\\\//g, '/');
    formPayload.append('data', dataField);

    const requestPreview = {
      url: targetUrl,
      action: selectedAction,
      actionType: selectedActionType,
      instance: selectedInstance,
      input: selectedInput,
      output: selectedOutput,
      user: authUser,
      token: '••••••',
      centro_cod: centroCod,
      empresa_cif: empresaCif,
      trabajador_dni: trabajadorDni,
      data: payloadData
    };

    const encodedForm = formPayload.toString();

    try {
      const response = await axios.post<string>(targetUrl, encodedForm, {
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        timeout: ecoordinaDefaults.timeoutMs,
        responseType: 'text',
        validateStatus: () => true
      });

      const rawText = response.data ?? '';
      let parsed: unknown = null;
      if (rawText) {
        try {
          parsed = JSON.parse(rawText);
        } catch (error) {
          parsed = rawText;
        }
      }

      if (response.status < 200 || response.status >= 300) {
        res.status(response.status).json({
          error: 'ECOORDINA_REQUEST_FAILED',
          status: response.status,
          message: response.statusText,
          payload: requestPreview,
          payloadSent: payload,
          formPayload: Object.fromEntries(formPayload.entries()),
          formBody: encodedForm,
          raw: rawText,
          data: parsed
        });
        return;
      }

      res.json({
        status: response.status,
        payload: requestPreview,
        payloadSent: payload,
        formPayload: Object.fromEntries(formPayload.entries()),
        formBody: encodedForm,
        raw: rawText,
        data: parsed
      });
    } catch (error) {
      const err = error as AxiosError;
      const status = err.response?.status ?? 502;
      const rawText = typeof err.response?.data === 'string' ? err.response.data : undefined;
      res.status(status).json({
        error: err.code === 'ECONNABORTED' ? 'ECOORDINA_TIMEOUT' : 'ECOORDINA_UNAVAILABLE',
        message: err.message,
        payload: requestPreview,
        payloadSent: payload,
        raw: rawText
      });
    }
  });

  router.get('/api/history', ensureAuthenticated, (_req, res) => {
    res.json({ history });
  });

  router.post('/api/simulate', ensureAuthenticated, async (req, res) => {
    const { cardId, mac, timestamp, additional } = req.body ?? {};

    if (typeof cardId !== 'string' || cardId.trim() === '') {
      res.status(400).json({ error: 'CARD_ID_REQUIRED' });
      return;
    }

    if (typeof mac !== 'string' || mac.trim() === '') {
      res.status(400).json({ error: 'MAC_REQUIRED' });
      return;
    }

    const normalizedMac = normalizeMacForDisplay(mac);
    const normalizedTimestamp =
      typeof timestamp === 'string' && timestamp.trim() !== ''
        ? timestamp
        : new Date().toISOString();

    let additionalData: Record<string, unknown> | undefined;
    if (additional && typeof additional === 'object') {
      additionalData = additional as Record<string, unknown>;
    }

    try {
      const evaluation = await simulateScan({
        cardId: cardId.trim(),
        mac: normalizedMac,
        timestamp: normalizedTimestamp,
        additional: additionalData
      });

      const event: HistoryEvent = {
        ...evaluation,
        cardId: cardId.trim(),
        mac: normalizedMac,
        timestamp: normalizedTimestamp,
        source: 'web'
      };

      recordEvent(event);
      res.json(event);
    } catch (error) {
      logger.error({ err: error }, 'Failed to simulate RFID scan via web interface');
      res.status(500).json({ error: 'SIMULATION_FAILED' });
    }
  });

  const parseScenario = (value: unknown): AccessDecision | null => {
    if (typeof value !== 'string') return null;
    const normalized = value.trim().toLowerCase();
    if (['granted', 'permitido', 'acceso permitido', 'allow'].includes(normalized)) {
      return 'GRANTED';
    }
    if (['denied', 'denegado', 'acceso denegado', 'deny'].includes(normalized)) {
      return 'DENIED';
    }
    return null;
  };

  router.get('/api/gpo/status', ensureAuthenticated, ensureAdmin, (_req, res) => {
    if (!gpoController) {
      res.status(503).json({ error: 'GPO_CONTROLLER_UNAVAILABLE', status: { enabled: false } });
      return;
    }

    res.json({ status: gpoController.status() });
  });

  router.post('/api/gpo/test/scenario', ensureAuthenticated, ensureAdmin, async (req, res) => {
    if (!gpoController) {
      res.status(503).json({ error: 'GPO_CONTROLLER_UNAVAILABLE' });
      return;
    }

    const decision = parseScenario(req.body?.scenario);
    if (!decision) {
      res.status(400).json({ error: 'INVALID_SCENARIO' });
      return;
    }

    if (!gpoController.isEnabled()) {
      res.status(503).json({ error: 'GPO_DISABLED' });
      return;
    }

    try {
      const readerResponses = await gpoController.triggerDecision(decision);
      res.json({ ok: true, decision, readerResponses });
    } catch (error) {
      logger.error({ err: error, decision }, 'Failed to run GPO scenario test');

      const axiosError = error as AxiosError;
      if (axios.isAxiosError(axiosError) && axiosError.response) {
        res.status(axiosError.response.status || 500).json({
          error: 'GPO_SCENARIO_FAILED',
          readerError: { status: axiosError.response.status, data: axiosError.response.data }
        });
        return;
      }

      res.status(500).json({ error: 'GPO_SCENARIO_FAILED' });
    }
  });

  router.post('/api/gpo/base-url', ensureAuthenticated, ensureAdmin, (req, res) => {
    if (!gpoController) {
      res.status(503).json({ error: 'GPO_CONTROLLER_UNAVAILABLE' });
      return;
    }

    const baseUrl = typeof req.body?.baseUrl === 'string' ? req.body.baseUrl.trim() : '';

    if (!baseUrl) {
      res.status(400).json({ error: 'INVALID_BASE_URL' });
      return;
    }

    gpoController.updateBaseUrl(baseUrl);
    res.json({ status: gpoController.status() });
  });

  router.post('/api/gpo/test/line', ensureAuthenticated, ensureAdmin, async (req, res) => {
    if (!gpoController) {
      res.status(503).json({ error: 'GPO_CONTROLLER_UNAVAILABLE' });
      return;
    }

    const line = Number.parseInt(req.body?.line, 10);
    const action = typeof req.body?.action === 'string' ? req.body.action.trim().toLowerCase() : '';
    const duration = req.body?.durationMs !== undefined ? Number(req.body.durationMs) : undefined;

    if (Number.isNaN(line)) {
      res.status(400).json({ error: 'INVALID_LINE' });
      return;
    }

    if (!['on', 'off', 'pulse'].includes(action)) {
      res.status(400).json({ error: 'INVALID_ACTION' });
      return;
    }

    if (duration !== undefined && (!Number.isFinite(duration) || duration <= 0)) {
      res.status(400).json({ error: 'INVALID_DURATION' });
      return;
    }

    if (!gpoController.isEnabled()) {
      res.status(503).json({ error: 'GPO_DISABLED' });
      return;
    }

    try {
      const readerResponse = await gpoController.controlLine(
        line,
        action as 'on' | 'off' | 'pulse',
        duration
      );
      res.json({
        ok: true,
        line,
        action,
        durationMs: action === 'pulse' ? duration ?? 1000 : undefined,
        readerResponse
      });
    } catch (error) {
      const err = error as Error;
      const knownErrors = ['INVALID_LINE', 'GPO_DISABLED'];
      if (knownErrors.includes(err.message)) {
        res.status(400).json({ error: err.message });
        return;
      }

      logger.error({ err, line, action, duration }, 'Failed to control reader GPO line');

      const axiosError = err as AxiosError;
      if (axios.isAxiosError(axiosError) && axiosError.response) {
        res.status(axiosError.response.status || 500).json({
          error: 'GPO_CONTROL_FAILED',
          readerError: { status: axiosError.response.status, data: axiosError.response.data }
        });
        return;
      }

      res.status(500).json({ error: 'GPO_CONTROL_FAILED' });
    }
  });

  const currentDir = path.dirname(fileURLToPath(import.meta.url));
  const publicDir = path.join(currentDir, '..', 'public');

  const staticCacheControl = (filePath: string): string => {
    const ext = path.extname(filePath);
    if (ext === '.html') {
      return 'no-store';
    }

    if (ext === '.js') {
      return 'public, max-age=300, immutable';
    }

    if (ext === '.css' || ext === '.png' || ext === '.svg' || ext === '.ico') {
      return 'public, max-age=3600';
    }

    return 'public, max-age=300';
  };

  const htmlTemplates = new Map<string, string>();
  const basePathForClient = basePath === '/' ? '' : basePath;

  const extractPartial = (html: string): string => {
    const title = html.match(/<title[\s\S]*?<\/title>/i)?.[0] ?? '';
    const main = html.match(/<main[\s\S]*<\/main>/i)?.[0] ?? '';
    const scripts = [...html.matchAll(/<script[\s\S]*?<\/script>/gi)].map((match) => match[0]);

    if (!main && scripts.length === 0) {
      return html;
    }

    return [title, main, scripts.join('\n')].filter(Boolean).join('\n');
  };

  const renderHtml = async (fileName: string, req: express.Request, res: express.Response): Promise<void> => {
    try {
      if (!htmlTemplates.has(fileName)) {
        const template = await readFile(path.join(publicDir, fileName), 'utf8');
        htmlTemplates.set(fileName, template);
      }
      const template = htmlTemplates.get(fileName) as string;
      const resolved = template.replace(/__BASE_PATH__/g, basePathForClient);
      res.setHeader('Cache-Control', 'no-store');

      if (req.headers['x-partial'] === '1') {
        res.type('html').send(extractPartial(resolved));
        return;
      }

      res.type('html').send(resolved);
    } catch (error) {
      logger.warn({ err: error, fileName }, 'Failed to render HTML template');
      res.status(404).send('Not found');
    }
  };

  router.get(['/', '/index.html'], (req, res) => {
    void renderHtml('index.html', req, res);
  });

  router.get(['/elecnor-usuarios', '/elecnor-usuarios.html'], (req, res) => {
    void renderHtml('elecnor-usuarios.html', req, res);
  });

  router.get(['/elecnor-tarjetas', '/elecnor-tarjetas.html'], (req, res) => {
    void renderHtml('elecnor-tarjetas.html', req, res);
  });

  router.get(['/elecnor-cuentas', '/elecnor-cuentas.html'], (req, res) => {
    void renderHtml('elecnor-cuentas.html', req, res);
  });

  router.get(['/elecnor-lecturas', '/elecnor-lecturas.html'], (req, res) => {
    void renderHtml('elecnor-lecturas.html', req, res);
  });

  router.get(
    ['/elecnor-accesos', '/elecnor-accesos.html', '/elecnor-webservice', '/elecnor-webservice.html'],
    (req, res) => {
      void renderHtml('elecnor-accesos.html', req, res);
    }
  );

  router.get(['/elecnor-seguimiento', '/elecnor-seguimiento.html'], (req, res) => {
    void renderHtml('elecnor-seguimiento.html', req, res);
  });

  router.get(['/elecnor-gpo', '/elecnor-gpo.html'], (req, res) => {
    void renderHtml('elecnor-gpo.html', req, res);
  });

  router.use(
    express.static(publicDir, {
      index: false,
      setHeaders: (res, servedPath) => {
        res.setHeader('Cache-Control', staticCacheControl(servedPath));
      }
    })
  );

  router.get('*', (req, res) => {
    void renderHtml('index.html', req, res);
  });

  app.use(basePath, router);

  let controllerClose: () => Promise<void> = async () => {};

  await new Promise<void>((resolve, reject) => {
    const server = app
      .listen(config.port, '0.0.0.0', () => {
        logger.info({ port: config.port, basePath }, 'Web test interface listening');
        resolve();
      })
      .on('error', (error) => {
        reject(error);
      });

    // Attach close handler to controller closure
    controllerClose = () =>
      new Promise<void>((closeResolve, closeReject) => {
        server.close((closeError) => {
          if (closeError) {
            closeReject(closeError);
            return;
          }
          closeResolve();
        });
      });
  });

  return {
    recordEvent,
    close: () => controllerClose()
  };
};

