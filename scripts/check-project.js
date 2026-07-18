#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const required = [
  'Code.gs',
  'Leaderboard.html',
  'README.md',
  'appsscript.json',
  'CODEX_TASK.md',
  'docs/ARCHITECTURE.md',
  'docs/ACCEPTANCE_CRITERIA.md',
  'docs/TEST_PLAN.md'
];

const failures = [];
for (const relative of required) {
  if (!fs.existsSync(path.join(root, relative))) {
    failures.push(`Missing required file: ${relative}`);
  }
}

const textExtensions = new Set(['.js', '.gs', '.html', '.md', '.json', '.css']);
const forbiddenPatterns = [
  { label: 'hard-coded Apps Script deployment URL', regex: /https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec/g },
  { label: 'probable private key', regex: /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g },
  { label: 'probable Google API key', regex: /AIza[0-9A-Za-z_-]{30,}/g },
  { label: 'probable GitHub token', regex: /gh[pousr]_[A-Za-z0-9_]{30,}/g }
];

function walk(directory) {
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'coverage'].includes(entry.name)) continue;
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      walk(absolute);
      continue;
    }
    if (!textExtensions.has(path.extname(entry.name))) continue;
    const relative = path.relative(root, absolute);
    const content = fs.readFileSync(absolute, 'utf8');
    for (const pattern of forbiddenPatterns) {
      if (pattern.regex.test(content)) {
        failures.push(`${relative}: ${pattern.label}`);
      }
      pattern.regex.lastIndex = 0;
    }
  }
}

walk(root);

if (failures.length) {
  console.error('Project checks failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('Project checks passed.');
}
