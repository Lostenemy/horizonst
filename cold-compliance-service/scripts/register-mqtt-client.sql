-- Register cold-compliance-service MQTT identity in VerneMQ ACL storage.
-- Requires vmq_diversity PostgreSQL schema with table vmq_auth_acl.
-- Replace <STRONG_PASSWORD> before running.
INSERT INTO vmq_auth_acl
(mountpoint, client_id, username, password, publish_acl, subscribe_acl)
VALUES
(
  '',
  'cold-compliance-service',
  'Horizon@user2024',
  crypt('<STRONG_PASSWORD>', gen_salt('bf')),
  '[{"pattern":"gw/+/subscribe","qos":1}]',
  '[{"pattern":"gw/+/publish","qos":1}]'
);
