-- Register cold-compliance-service MQTT identity in VerneMQ ACL storage.
-- Requires vmq_diversity PostgreSQL schema with table vmq_auth_acl.
-- Replace <STRONG_PASSWORD> and <GATEWAY_MAC>. Add one exact ACL entry per
-- gateway assigned to Horneo; never grant gw/+/publish to this identity.
INSERT INTO vmq_auth_acl
(mountpoint, client_id, username, password, publish_acl, subscribe_acl)
VALUES
(
  '',
  'cold-compliance-service',
  'Horizon@user2024',
  crypt('<STRONG_PASSWORD>', gen_salt('bf')),
  '[{"pattern":"gw/<GATEWAY_MAC>/subscribe","qos":1}]',
  '[{"pattern":"gw/<GATEWAY_MAC>/publish","qos":1}]'
);
