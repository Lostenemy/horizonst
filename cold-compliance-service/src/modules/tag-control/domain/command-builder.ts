import { buzzerSchema, ledSchema, vibrationSchema } from './validators';
import { BuzzerCommandData, CommandKind, LedCommandData, VibrationCommandData } from './types';

export function commandCode(kind: CommandKind): number {
  if (kind === 'led') return 1101;
  if (kind === 'buzzer') return 1102;
  return 1103;
}

export function buildCommandPayload(args: {
  msgId: number;
  gatewayMac: string;
  tagMac: string;
  kind: CommandKind;
  data: LedCommandData | BuzzerCommandData | VibrationCommandData;
}): Record<string, unknown> {
  const gatewayMac = args.gatewayMac.toUpperCase();
  const tagMac = args.tagMac.toUpperCase();

  let data: Record<string, unknown>;
  if (args.kind === 'led') {
    const parsed = ledSchema.parse(args.data);
    data = { mac: tagMac, led_state: parsed.state, duration: parsed.duration };
  } else if (args.kind === 'buzzer') {
    const parsed = buzzerSchema.parse(args.data as BuzzerCommandData);
    data = { mac: tagMac, buzzer_state: parsed.state, frequency: parsed.frequency, duration: parsed.duration };
  } else {
    const parsed = vibrationSchema.parse(args.data as VibrationCommandData);
    data = { mac: tagMac, vibration_state: parsed.state, intensity: parsed.intensity, duration: parsed.duration };
  }

  return {
    msg_id: args.msgId,
    device_info: { mac: gatewayMac },
    data
  };
}
