#!/bin/sh
set -e

# 1) Populate Roundcube if missing
[ -x /docker-entrypoint.sh ] && /docker-entrypoint.sh true || true

# 2) Ensure minimal config under /webmail
mkdir -p /var/www/html/config
cfg=/var/www/html/config/config.docker.inc.php
if [ ! -f "$cfg" ]; then
  cat > "$cfg" <<'PHP'
<?php
$config["base_url"]    = "/webmail/";
$config["force_https"] = true;

$config["default_host"] = "ssl://mail";
$config["default_port"] = 993;

$config["smtp_server"] = "tls://mail";
$config["smtp_port"]   = 587;
$config["smtp_user"]   = "%u";
$config["smtp_pass"]   = "%p";

// Durante pruebas: aceptar cert autofirmado del mailserver
$config["imap_conn_options"] = ["ssl" => ["verify_peer" => false, "verify_peer_name" => false]];
$config["smtp_conn_options"] = ["ssl" => ["verify_peer" => false, "verify_peer_name" => false]];
PHP
fi

# 3) Launch Apache in foreground
exec apache2-foreground
