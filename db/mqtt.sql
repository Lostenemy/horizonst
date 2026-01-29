CREATE TABLE IF NOT EXISTS vmq_auth_acl (
  mountpoint text NOT NULL DEFAULT '',
  client_id text NOT NULL,
  username text NOT NULL,
  password text NOT NULL,
  publish_acl jsonb NOT NULL DEFAULT '[]',
  subscribe_acl jsonb NOT NULL DEFAULT '[]'
);

CREATE INDEX IF NOT EXISTS vmq_auth_acl_client_idx ON vmq_auth_acl(client_id);
CREATE INDEX IF NOT EXISTS vmq_auth_acl_username_idx ON vmq_auth_acl(username);
