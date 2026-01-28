CREATE TABLE IF NOT EXISTS mqtt_user (
  id serial PRIMARY KEY,
  username text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  salt text NOT NULL DEFAULT '',
  is_superuser boolean DEFAULT false,
  created timestamp with time zone DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS mqtt_acl(
  id serial PRIMARY KEY,
  username text NOT NULL,
  permission text NOT NULL,  -- allow|deny
  action text NOT NULL,      -- publish|subscribe|all
  topic text NOT NULL,
  qos smallint,
  retain smallint
);

CREATE INDEX IF NOT EXISTS mqtt_acl_username_idx ON mqtt_acl(username);
