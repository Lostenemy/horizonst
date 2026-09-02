import { env } from '../../config/env';

export type HardwareB5Command = 'connect' | 'led' | 'buzzer' | 'vibration' | 'disconnect';

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
  action: 'apply-rssi' | 'configure-emergency-button';
  body?: Record<string, unknown>;
  fetchImpl?: typeof fetch;
}): Promise<{ status: number; body: Record<string, unknown> }> {
  if (!env.HARDWARE_MANAGER_ENABLED) throw new Error('Hardware Manager command execution is disabled');
  if (!params.hardwareGatewayId) throw new Error('Central gateway mapping is required');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.HARDWARE_MANAGER_COMMAND_TIMEOUT_MS);
  timer.unref();
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
    clearTimeout(timer);
  }
}
