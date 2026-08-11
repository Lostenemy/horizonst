import { env } from '../../config/env';
import { logger } from '../../utils/logger';
import { mqttPublish } from '../mqtt/mqtt.service';
import { GatewayAck, waitForGatewayReplyMulti } from '../tag-control/infrastructure/gateway-reply-listener';

export interface GatewayEmergencyCommand extends Record<string, unknown> {
  msg_id: number;
  device_info: { mac: string };
  data: Record<string, number>;
}

export interface GatewayEmergencyCommandResult {
  msgId: number;
  status: 'success' | 'error' | 'timeout';
  resultCode?: number;
  resultMsg?: string;
  ackMsgId?: number;
}

export function buildEmergencyButtonCommands(gatewayMac: string): GatewayEmergencyCommand[] {
  const deviceInfo = { mac: gatewayMac.toUpperCase() };
  return [
    {
      msg_id: 1045,
      device_info: deviceInfo,
      data: {
        ibeacon: 0,
        eddystone_uid: 0,
        eddystone_url: 0,
        eddystone_tlm: 0,
        bxp_devinfo: 0,
        bxp_acc: 0,
        bxp_th: 0,
        bxp_button: 1,
        bxp_tag: 0,
        pir: 0,
        other: 0,
        mk_tof: 0,
        nano_beacon_info: 0
      }
    },
    {
      msg_id: 1053,
      device_info: deviceInfo,
      data: {
        switch_value: 1,
        single_press: 0,
        double_press: 1,
        long_press: 0,
        abnormal_inactivity: 0
      }
    },
    {
      msg_id: 1059,
      device_info: deviceInfo,
      data: {
        timestamp: 1,
        adv_data: 1,
        parse_adv_data: 1
      }
    },
    {
      msg_id: 1063,
      device_info: deviceInfo,
      data: { interval: 0 }
    }
  ];
}

export async function configureEmergencyButton(params: {
  gatewayMac: string;
  topic: string;
  timeoutMs?: number;
  deps?: {
    publish?: typeof mqttPublish;
    waitForReply?: typeof waitForGatewayReplyMulti;
  };
}): Promise<{ ok: boolean; results: GatewayEmergencyCommandResult[]; commands: GatewayEmergencyCommand[] }> {
  const publish = params.deps?.publish ?? mqttPublish;
  const waitForReply = params.deps?.waitForReply ?? waitForGatewayReplyMulti;
  const timeoutMs = params.timeoutMs ?? env.TAG_CONTROL_DEFAULT_TIMEOUT_MS;
  const commands = buildEmergencyButtonCommands(params.gatewayMac);
  const results: GatewayEmergencyCommandResult[] = [];

  for (const command of commands) {
    const replyPromise = waitForReply({
      gatewayMac: params.gatewayMac,
      msgIds: [command.msg_id, command.msg_id + 2000, command.msg_id + 2001],
      timeoutMs
    });
    void replyPromise.catch(() => undefined);

    try {
      await publish(params.topic, command);
      const ack: GatewayAck = await replyPromise;
      const status = ack.resultCode === 0 ? 'success' : 'error';
      results.push({
        msgId: command.msg_id,
        status,
        resultCode: ack.resultCode,
        resultMsg: ack.resultMsg,
        ackMsgId: ack.msgId
      });
      logger[status === 'success' ? 'info' : 'warn']({
        gatewayMac: params.gatewayMac,
        topic: params.topic,
        msgId: command.msg_id,
        ackMsgId: ack.msgId,
        resultCode: ack.resultCode,
        resultMsg: ack.resultMsg
      }, 'emergency button gateway command completed');
    } catch (error: any) {
      const message = String(error?.message ?? error);
      const timeout = message.includes('timeout waiting gateway reply');
      results.push({
        msgId: command.msg_id,
        status: timeout ? 'timeout' : 'error',
        resultMsg: message
      });
      logger.warn({ gatewayMac: params.gatewayMac, topic: params.topic, msgId: command.msg_id, error: message }, 'emergency button gateway command failed');
    }
  }

  return { ok: results.every((result) => result.status === 'success'), results, commands };
}
