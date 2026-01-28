local bcrypt = require("bcrypt")
local postgres = require("postgres")

local function fetch_user(username)
  return postgres.query(
    "SELECT password_hash, is_superuser FROM mqtt_user WHERE username = $1 LIMIT 1",
    { username }
  )
end

local function fetch_acls(username)
  return postgres.query(
    "SELECT permission, action, topic, qos, retain FROM mqtt_acl WHERE username = $1",
    { username }
  )
end

local function verify_password(password, password_hash)
  if not password_hash or password_hash == "" then
    return false
  end
  return bcrypt.verify(password, password_hash)
end

local function to_vmq_permission(permission)
  if permission == "allow" then
    return true
  end
  return false
end

local function map_acl_rows(rows)
  local acl = {
    publish = {},
    subscribe = {}
  }

  for _, row in ipairs(rows or {}) do
    local perm = to_vmq_permission(row.permission)
    local action = row.action
    local entry = {
      topic = row.topic,
      qos = tonumber(row.qos) or 0
    }

    if action == "publish" or action == "all" then
      entry.allow = perm
      table.insert(acl.publish, entry)
    end
    if action == "subscribe" or action == "all" then
      entry.allow = perm
      table.insert(acl.subscribe, entry)
    end
  end

  return acl
end

function auth_on_register(reg)
  local rows = fetch_user(reg.username)
  if not rows or #rows == 0 then
    return false
  end

  local user = rows[1]
  if not verify_password(reg.password, user.password_hash) then
    return false
  end

  return true
end

function auth_on_publish(reg, topic, payload, qos, retain)
  local rows = fetch_acls(reg.username)
  local acl = map_acl_rows(rows)
  return auth_on_publish_match(topic, qos, retain, acl.publish)
end

function auth_on_subscribe(reg, topics)
  local rows = fetch_acls(reg.username)
  local acl = map_acl_rows(rows)
  return auth_on_subscribe_match(topics, acl.subscribe)
end

function auth_on_register_m5(reg)
  return auth_on_register(reg)
end

function auth_on_publish_m5(reg, topic, payload, qos, retain, props)
  return auth_on_publish(reg, topic, payload, qos, retain)
end

function auth_on_subscribe_m5(reg, topics, props)
  return auth_on_subscribe(reg, topics)
end
