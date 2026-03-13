import { Router } from 'express';
import { z } from 'zod';
import {
  createTemplate,
  getCommand,
  listActiveCommands,
  listCommands,
  listTemplates,
  sendTagCommand,
  updateTemplate
} from './application/tag-control.service';

export const tagControlRouter = Router();

const targetSchema = z.object({
  workerId: z.string().uuid().optional(),
  tagId: z.string().uuid().optional(),
  tagUid: z.string().optional(),
  gatewayMac: z.string().optional(),
  timeoutMs: z.number().int().positive().optional()
});

tagControlRouter.post('/led', async (req, res, next) => {
  try {
    const parsed = targetSchema.extend({ state: z.union([z.literal(0), z.literal(1)]), duration: z.number().int().min(0).max(65535) }).parse(req.body);
    res.status(202).json(await sendTagCommand({ ...parsed, commandKind: 'led', commandData: { state: parsed.state, duration: parsed.duration }, triggerSource: 'user', triggerReason: 'manual led alert' }));
  } catch (e) { next(e); }
});

tagControlRouter.post('/buzzer', async (req, res, next) => {
  try {
    const parsed = targetSchema.extend({ state: z.union([z.literal(0), z.literal(1)]), frequency: z.number().int().min(1).max(5000), duration: z.number().int().min(0).max(65535) }).parse(req.body);
    res.status(202).json(await sendTagCommand({ ...parsed, commandKind: 'buzzer', commandData: { state: parsed.state, frequency: parsed.frequency, duration: parsed.duration }, triggerSource: 'user', triggerReason: 'manual buzzer alert' }));
  } catch (e) { next(e); }
});

tagControlRouter.post('/vibration', async (req, res, next) => {
  try {
    const parsed = targetSchema.extend({ state: z.union([z.literal(0), z.literal(1)]), intensity: z.number().int().min(0).max(100), duration: z.number().int().min(0).max(65535) }).parse(req.body);
    res.status(202).json(await sendTagCommand({ ...parsed, commandKind: 'vibration', commandData: { state: parsed.state, intensity: parsed.intensity, duration: parsed.duration }, triggerSource: 'user', triggerReason: 'manual vibration alert' }));
  } catch (e) { next(e); }
});


tagControlRouter.post('/custom', async (req, res, next) => {
  try {
    const parsed = targetSchema.extend({ templateCode: z.string().min(1), reason: z.string().min(2).optional() }).parse(req.body);
    res.status(202).json(await sendTagCommand({ ...parsed, templateCode: parsed.templateCode, triggerSource: 'user', triggerReason: parsed.reason ?? 'manual custom template alert' }));
  } catch (e) { next(e); }
});
tagControlRouter.post('/custom-alert', async (req, res, next) => {
  try {
    const parsed = targetSchema.extend({ templateCode: z.string().min(1), reason: z.string().min(2).optional() }).parse(req.body);
    res.status(202).json(await sendTagCommand({ ...parsed, templateCode: parsed.templateCode, triggerSource: 'user', triggerReason: parsed.reason ?? 'manual custom template alert' }));
  } catch (e) { next(e); }
});

tagControlRouter.get('/commands', async (_req, res, next) => {
  try { res.json(await listCommands()); } catch (e) { next(e); }
});

tagControlRouter.get('/commands/active', async (_req, res, next) => {
  try { res.json(await listActiveCommands()); } catch (e) { next(e); }
});

tagControlRouter.get('/commands/:id', async (req, res, next) => {
  try {
    const result = await getCommand(req.params.id);
    if (!result) return res.status(404).json({ error: 'not_found' });
    res.json(result);
  } catch (e) { next(e); }
});

tagControlRouter.get('/templates', async (_req, res, next) => {
  try { res.json(await listTemplates()); } catch (e) { next(e); }
});

tagControlRouter.post('/templates', async (req, res, next) => {
  try {
    const parsed = z.object({ code: z.string().min(1), name: z.string().min(1), description: z.string().optional(), channels: z.record(z.any()) }).parse(req.body);
    res.status(201).json(await createTemplate(parsed));
  } catch (e) { next(e); }
});

tagControlRouter.patch('/templates/:id', async (req, res, next) => {
  try {
    const parsed = z.object({ name: z.string().optional(), description: z.string().optional(), channels: z.record(z.any()).optional(), active: z.boolean().optional() }).parse(req.body);
    res.json(await updateTemplate(req.params.id, parsed));
  } catch (e) { next(e); }
});
