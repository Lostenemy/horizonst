export const GATT_PROTOCOL = Object.freeze({
  commandTopicTemplate: "gw/{gatewayMac}/subscribe",
  responseTopicTemplate: "gw/{gatewayMac}/publish",
  commandMsgIds: Object.freeze({
    connect: 1100,
    readSensors: 1102,
    systemInfo: 2002
  })
});

export function toGatewayMac(value) {
  return String(value || "").replace(/[^0-9a-fA-F]/g, "").toUpperCase();
}

export function isValidMac(value) {
  return /^[0-9A-F]{12}$/.test(toGatewayMac(value));
}

export function buildGatewayTopic(template, gatewayMac) {
  return String(template || "").replaceAll("{gatewayMac}", toGatewayMac(gatewayMac).toLowerCase());
}

export function buildGattCommandTopic(gatewayMac, template = GATT_PROTOCOL.commandTopicTemplate) {
  return buildGatewayTopic(template, gatewayMac);
}

export function buildGattResponseTopic(gatewayMac, template = GATT_PROTOCOL.responseTopicTemplate) {
  return buildGatewayTopic(template, gatewayMac);
}

export function parseGatewayMacFromTopic(topic, template = GATT_PROTOCOL.responseTopicTemplate) {
  const marker = "{gatewayMac}";
  const index = template.indexOf(marker);
  if (index === -1) {
    return "";
  }

  const prefix = template.slice(0, index);
  const suffix = template.slice(index + marker.length);

  if (!topic.startsWith(prefix) || !topic.endsWith(suffix) || topic.length < prefix.length + suffix.length) {
    return "";
  }

  const raw = topic.slice(prefix.length, topic.length - suffix.length);
  const normalized = toGatewayMac(raw);
  return isValidMac(normalized) ? normalized : "";
}

export function topicMatchesPattern(topic, pattern) {
  const escaped = pattern
    .split("+")
    .map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^/]+");
  const regex = new RegExp(`^${escaped}$`);
  return regex.test(topic);
}

export function hasExpectedGatewayMac(expectedGatewayMac, payloadGatewayMac) {
  const expected = toGatewayMac(expectedGatewayMac);
  const received = toGatewayMac(payloadGatewayMac);
  return Boolean(expected && received && expected === received);
}

export function parseMsgIdList(raw, fallback) {
  if (!raw) {
    return fallback;
  }

  const values = String(raw)
    .split(",")
    .map((value) => Number.parseInt(value.trim(), 10))
    .filter((value) => Number.isInteger(value));
  return values.length > 0 ? values : fallback;
}

export function parseTopicPatterns(value) {
  return String(value || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}
