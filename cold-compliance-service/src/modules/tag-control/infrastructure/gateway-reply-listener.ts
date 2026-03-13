import { addMqttMessageHandler } from '../../mqtt/mqtt.service';
import { logger } from '../../../utils/logger';
import { appendAuditLog } from '../../audit/audit.service';
import { appendResponse, findOpenCommandByGatewayAndMsgId, updateCommandStatus } from './tag-command.repository';

const resultMap: Record<number, string> = {
  0: 'success',
  1: 'length error',
  2: 'type error',
  3: 'range error',
  4: 'no object error'
};

export function startGatewayReplyListener(): void {
  addMqttMessageHandler(async (topic, payloadBuf) => {
    if (!topic.endsWith('/publish')) return;

    let payload: any;
    try {
      payload = JSON.parse(payloadBuf.toString('utf8'));
    } catch {
      return;
    }

    if (typeof payload?.msg_id !== 'number' || typeof payload?.result_code !== 'number') return;

    const gatewayMacFromTopic = topic.split('/')[1]?.toLowerCase();
    const gatewayMac = String(payload?.device_info?.mac ?? gatewayMacFromTopic ?? '').toLowerCase();
    if (!gatewayMac) return;

    const cmd = await findOpenCommandByGatewayAndMsgId(gatewayMac, payload.msg_id);
    if (!cmd) return;

    await appendResponse({
      tagCommandId: cmd.id,
      gatewayMac,
      msgId: payload.msg_id,
      resultCode: payload.result_code,
      resultMsg: payload.result_msg ?? resultMap[payload.result_code],
      payload
    });

    const ok = payload.result_code === 0;
    await updateCommandStatus(cmd.id, ok ? 'ack_ok' : 'ack_error', { completed: true, lastError: ok ? undefined : (payload.result_msg ?? resultMap[payload.result_code]) });
    await appendAuditLog({
      actorType: 'system',
      action: ok ? 'tag_command_ack_ok' : 'tag_command_ack_error',
      entityType: 'tag_command',
      entityId: cmd.id,
      payload: {
        gatewayMac,
        msgId: payload.msg_id,
        resultCode: payload.result_code,
        resultMsg: payload.result_msg ?? resultMap[payload.result_code]
      }
    });
  });

  logger.info('gateway reply listener initialized');
}
