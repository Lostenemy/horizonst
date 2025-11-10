#!/usr/bin/env bash
set -euo pipefail

# Run the original entrypoint until configuration files are generated.
/docker-entrypoint.sh true

cfg="/var/www/html/config/config.docker.inc.php"

for _ in {1..30}; do
  if [ -f "$cfg" ]; then
    break
  fi
  sleep 1
done

if [ ! -f "$cfg" ]; then
  echo "Failed to find $cfg after waiting" >&2
  exit 1
fi

cp -a "$cfg" "${cfg}.bak.$(date +%F_%H%M%S)"

php -r "
\$f = getenv('CFG_PATH');
\$add = <<<'PHP'
\$config['base_url'] = '/webmail/';
\$config['force_https'] = true;
\$config['trusted_proxies'] = ['127.0.0.1','172.18.0.0/16'];
PHP;
\$s = file_get_contents(\$f);
if (strpos(\$s, 'base_url') === false) {
    file_put_contents(\$f, PHP_EOL.\$add, FILE_APPEND);
}
" CFG_PATH="$cfg"

exec apache2-foreground
