const blockedCommandPatterns = [
  { pattern: /\bgit\s+reset\s+--hard\b/i, reason: 'git reset --hard esta bloqueado en HorizonST.' },
  { pattern: /\bgit\s+clean\b/i, reason: 'git clean esta bloqueado en HorizonST.' },
  { pattern: /\bgit\s+push\s+(?:--force|-f)\b/i, reason: 'force push esta bloqueado en HorizonST.' },
  { pattern: /\bgit\s+push\s+origin\s+main\b/i, reason: 'push directo a main esta bloqueado en HorizonST.' },
  { pattern: /\bgit\s+branch\s+-D\b/i, reason: 'borrado forzado de ramas esta bloqueado en HorizonST.' },
  { pattern: /\bdocker\s+system\s+prune\b/i, reason: 'docker system prune esta bloqueado en HorizonST.' },
  { pattern: /\bdocker\s+volume\s+rm\b/i, reason: 'eliminacion de volumenes Docker esta bloqueada en HorizonST.' },
  { pattern: /\bdocker\s+compose\s+down\s+-v\b/i, reason: 'docker compose down -v esta bloqueado en HorizonST.' },
  { pattern: /\bcertbot\b/i, reason: 'Certbot no debe ejecutarse desde tareas OpenCode.' },
  { pattern: /\b(?:systemctl|sc\.exe)\b/i, reason: 'modificar servicios de sistema esta bloqueado en HorizonST.' },
  { pattern: /\b(?:nginx|nginx\.exe)\b/i, reason: 'modificar o recargar Nginx esta bloqueado en HorizonST.' },
  { pattern: /\b(?:DROP\s+DATABASE|DROP\s+SCHEMA|TRUNCATE)\b/i, reason: 'SQL destructivo evidente esta bloqueado en HorizonST.' },
  { pattern: /\b(?:npm|npm\.cmd|node)\s+.*\bdist\/db\/migrate\.js\b/i, reason: 'migraciones contra entornos reales requieren autorizacion explicita.' },
  { pattern: /\b(?:Get-Content|type|cat|more)\b.*\.(?:pem|key|p12|pfx)\b/i, reason: 'leer claves o certificados privados esta bloqueado en HorizonST.' }
];

const blockedReadPatterns = [
  { pattern: /\.(?:pem|key|p12|pfx)$/i, reason: 'No leer claves o certificados privados.' },
  { pattern: /(?:^|[\\/])id_(?:rsa|ed25519)$/i, reason: 'No leer claves SSH privadas.' }
];

const isSensitiveEnvPath = (value) => {
  const normalized = value.replace(/\\/g, '/');
  const filename = normalized.split('/').pop() ?? '';
  return filename.startsWith('.env') && filename !== '.env.example' && !filename.endsWith('.example');
};

export const HorizonSTGuard = async () => ({
  'tool.execute.before': async (input, output) => {
    if (input.tool === 'bash') {
      const command = String(output.args?.command ?? '');
      if (/\b(?:Get-Content|type|cat|more)\b/i.test(command) && isSensitiveEnvPath(command)) {
        throw new Error('leer archivos .env esta bloqueado en HorizonST.');
      }
      const blocked = blockedCommandPatterns.find((entry) => entry.pattern.test(command));
      if (blocked) throw new Error(blocked.reason);
    }

    if (input.tool === 'read') {
      const filePath = String(output.args?.filePath ?? '');
      if (isSensitiveEnvPath(filePath)) throw new Error('No leer archivos .env.');
      const blocked = blockedReadPatterns.find((entry) => entry.pattern.test(filePath));
      if (blocked) throw new Error(blocked.reason);
    }
  }
});
