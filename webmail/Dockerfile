FROM roundcube/roundcubemail:1.6.6-apache

RUN set -eux; \
    cfg="/var/www/html/config/config.docker.inc.php"; \
    cp -a "$cfg" "${cfg}.bak"; \
    cat <<'PHP' >> "$cfg"

// === HorizonST (subpath /webmail) ===
$config['base_url'] = '/webmail/';
$config['force_https'] = true;
$config['trusted_proxies'] = ['127.0.0.1', '172.18.0.0/16'];
// === fin ajustes subpath ===
PHP
