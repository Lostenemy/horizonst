'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

function failures(text, service) {
  const lines = text.split(/\r?\n/);
  const result = [];
  for (let i = 0; i < lines.length; i++) {
    const match = /^not ok \d+ - (.+)$/.exec(lines[i]);
    if (!match) continue;
    let end = i + 1;
    while (end < lines.length && !/^(?:# Subtest:|ok \d|not ok \d|1\.\.)/.test(lines[end])) end++;
    const block = lines.slice(i, end).join('\n');
    const label = match[1].replace(/^\/(?:usr\/src\/app|app)\//, '');
    let category, resource;
    if (/code: 'ENOENT'/.test(block)) {
      category = 'missing_resource'; resource = /open '([^']+)'/.exec(block)?.[1];
    } else if (/error: 'test failed'/.test(block)) {
      // Errors at module load precede its own Subtest; do not classify the generic wrapper as root cause.
      let previous = i - 1;
      while (previous >= 0 && !/^# (?:Error:|node:)/.test(lines[previous])) previous--;
      const diagnostic = lines.slice(Math.max(0, previous), i).join('\n');
      resource = /Cannot find module '([^']+)'/.exec(diagnostic)?.[1]
        || /open '([^']+)'/.exec(diagnostic)?.[1];
      category = resource ? 'missing_resource_at_module_load' : 'unclassified';
    } else if (/code: 'ERR_ASSERTION'/.test(block) && label.startsWith('a delayed valid response')) {
      category = 'timing_unproven_root_cause';
    } else category = 'unclassified';
    result.push({ id: crypto.createHash('sha256').update(`${service}\0${label}`).digest('hex').slice(0, 12),
      service, test: label, category, ...(resource ? { resource } : {}),
      correction: category.startsWith('missing_resource') ? 'dedicated complete test workspace, never enlarge runtime'
        : 'explicit events and virtual clock; preserve deadline, wrong topic and late response assertions',
      validation: 'pending full corrected suite' });
  }
  return result;
}

if (require.main === module) {
  const evidence = process.argv[2];
  const output = process.argv[3];
  if (!evidence || !output) throw new Error('Usage: node inventory.cjs <evidence-directory> <new-output.json>');
  const inventory = [];
  for (const service of ['app', 'cold_compliance_service']) {
    for (const variant of ['pre-security', 'security']) {
      const file = `${service}-${variant}-20261022.tap`;
      for (const item of failures(fs.readFileSync(path.join(evidence, 'tests', file), 'utf8'), service)) {
        const existing = inventory.find(record => record.id === item.id);
        if (existing) existing.logs.push(file);
        else inventory.push({ ...item, logs: [file] });
      }
    }
  }
  inventory.sort((a, b) => a.service.localeCompare(b.service) || a.id.localeCompare(b.id));
  fs.writeFileSync(output, JSON.stringify(inventory, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ cases: inventory.length, unclassified: inventory.filter(i => i.category === 'unclassified').length }));
}
module.exports = { failures };
