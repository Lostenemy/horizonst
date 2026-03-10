import test from "node:test";
import assert from "node:assert/strict";

import {
  GATT_PROTOCOL,
  buildGattCommandTopic,
  buildGattResponseTopic,
  hasExpectedGatewayMac,
  parseGatewayMacFromTopic
} from "../src/gattProtocol.js";

test("builds MKGW3 topics with normalized gateway MAC", () => {
  assert.equal(buildGattCommandTopic("00:70:07:E0:C8:04"), "gw/007007e0c804/subscribe");
  assert.equal(buildGattResponseTopic("007007E0C804"), "gw/007007e0c804/publish");
});

test("extracts gateway MAC from publish topic", () => {
  assert.equal(parseGatewayMacFromTopic("gw/007007e0c804/publish"), "007007E0C804");
  assert.equal(parseGatewayMacFromTopic("devices/MK3/send"), "");
});

test("system info command uses msg_id 2002", () => {
  assert.equal(GATT_PROTOCOL.commandMsgIds.systemInfo, 2002);
});

test("device_info.mac validation requires exact MAC match", () => {
  assert.equal(hasExpectedGatewayMac("007007E0C804", "00:70:07:E0:C8:04"), true);
  assert.equal(hasExpectedGatewayMac("007007E0C804", "007007E0C805"), false);
});
