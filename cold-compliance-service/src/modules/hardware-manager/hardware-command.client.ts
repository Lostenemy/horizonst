import { env } from '../../config/env';

export type HardwareB5Command = 'connect' | 'led' | 'buzzer' | 'vibration' | 'disconnect';
type ManagementAction = 'apply-rssi' | 'configure-emergency-button';

export function hardwareManagementTimeoutMs(action: ManagementAction): number {
  return action === 'configure-emergency-button'
    ? env.HARDWARE_MANAGER_B5_CONFIGURATION_TIMEOUT_MS
    : env.HARDWARE_MANAGER_COMMAND_TIMEOUT_MS;
}

export async function executeHardwareB5Command(params: {
  hardwareGatewayId?: number | null;
  hardwareDeviceId?: number | null;
  command: HardwareB5Command;
  durationMs?: number;
  fetchImpl?: typeof fetch;
}): Promise<void> {
  if (!env.HARDWARE_MANAGER_ENABLED) throw new Error('Hardware Manager command execution is disabled');
  if (!params.hardwareGatewayId || !params.hardwareDeviceId) throw new Error('Central hardware mapping is required');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.HARDWARE_MANAGER_COMMAND_TIMEOUT_MS);
  timer.unref();
  try {
    const response = await (params.fetchImpl ?? fetch)(
      `${env.HARDWARE_MANAGER_BASE_URL.replace(/\/$/, '')}/api/internal/v1/hardware/gateways/${params.hardwareGatewayId}/b5-command`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.HARDWARE_MANAGER_SERVICE_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          deviceId: params.hardwareDeviceId,
          command: params.command,
          ...(params.durationMs === undefined ? {} : { durationMs: params.durationMs })
        }),
        signal: controller.signal
      }
    );
    if (!response.ok) {
      let detail = `HTTP ${response.status}`;
      try {
        const body = await response.json() as { resultCode?: number; resultMessage?: string; message?: string };
        detail = body.resultCode === undefined
          ? `${detail} ${body.message ?? ''}`.trim()
          : `${detail} result_code=${body.resultCode} result_msg=${body.resultMessage ?? '-'}`;
      } catch { /* response body is optional */ }
      throw new Error(`Hardware Manager B5 ${params.command} failed: ${detail}`);
    }
  } finally {
    clearTimeout(timer);
  }
}

export async function executeHardwareGatewayManagementCommand(params: {
  hardwareGatewayId?: number | null;
  action: ManagementAction;
  body?: Record<string, unknown>;
  fetchImpl?: typeof fetch;
  timer?: {
    set: typeof setTimeout;
    clear: typeof clearTimeout;
  };
}): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!env.HARDWARE_MANAGER_ENABLED) throw new Error('Hardware Manager command execution is disabled');
  if (!params.hardwareGatewayId) throw new Error('Central gateway mapping is required');
  const controller = new AbortController();
  const timerApi = params.timer ?? { set: setTimeout, clear: clearTimeout };
  const timer = timerApi.set(() => controller.abort(), hardwareManagementTimeoutMs(params.action));
  timer.unref?.();
  try {
    const response = await (params.fetchImpl ?? fetch)(
      `${env.HARDWARE_MANAGER_BASE_URL.replace(/\/$/, '')}/api/internal/v1/hardware/gateways/${params.hardwareGatewayId}/${params.action}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.HARDWARE_MANAGER_SERVICE_TOKEN}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify(params.body ?? {}),
        signal: controller.signal
      }
    );
    const body = await response.json().catch(() => ({})) as Record<string, unknown>;
    return { status: response.status, body };
  } finally {
    timerApi.clear(timer);
  }
}
