#!/usr/bin/env node

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const required = [
  'Code.gs',
  'AuthApi.gs',
  'AppFrontend.js',
  'config.js',
  'styles.css',
  'index.html',
  'Leaderboard.html',
  'README.md',
  'appsscript.json',
  '.nojekyll',
  'assets/guild-logo.png',
  '.github/workflows/pages.yml',
  'CODEX_TASK.md',
  'docs/ARCHITECTURE.md',
  'docs/ACCEPTANCE_CRITERIA.md',
  'docs/TEST_PLAN.md',
  'docs/DEPLOYMENT_CHECKLIST.md'
];

const failures = [];
for (const relative of required) {
  if (!fs.existsSync(path.join(root, relative))) {
    failures.push(`Missing required file: ${relative}`);
  }
}

const logo = path.join(root, 'assets/guild-logo.png');
if (fs.existsSync(logo) && fs.statSync(logo).size < 100) {
  failures.push('assets/guild-logo.png: supplied logo is empty or invalid');
}

function requireText(relative, patterns) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) return;
  const content = fs.readFileSync(absolute, 'utf8');
  for (const pattern of patterns) {
    if (!pattern.regex.test(content)) failures.push(`${relative}: ${pattern.label}`);
  }
}

requireText('Leaderboard.html', [
  { label: 'must load repository-relative config.js', regex: /<script src="config\.js"><\/script>/ },
  { label: 'must load repository-relative styles.css', regex: /<link rel="stylesheet" href="styles\.css">/ },
  { label: 'must load repository-relative AppFrontend.js', regex: /<script src="AppFrontend\.js"><\/script>/ },
  { label: 'must reference repository-relative supplied logo', regex: /(?:src|href)="assets\/guild-logo\.png"/ },
  { label: 'must provide a visible logo fallback', regex: /onerror="[^"]*nextElementSibling[^"]*"/ }
]);
requireText('config.js', [
  {
    label: 'must set configuredApiUrl to the documented placeholder or a valid Apps Script /exec URL',
    regex: /var configuredApiUrl = '(?:PASTE_APPS_SCRIPT_EXEC_URL_HERE|https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec)';/
  },
  { label: 'must expose the authoritative BPSR_CONFIG object', regex: /root\.BPSR_CONFIG\s*=/ }
]);
requireText('.github/workflows/pages.yml', [
  { label: 'must deploy on main pushes', regex: /branches:\s*\[main\]/ },
  { label: 'must support workflow_dispatch', regex: /workflow_dispatch:/ },
  { label: 'must grant pages write permission', regex: /pages:\s*write/ },
  { label: 'must grant id-token write permission', regex: /id-token:\s*write/ },
  { label: 'must use configure-pages', regex: /actions\/configure-pages@v\d+/ },
  { label: 'must publish the repository root', regex: /path:\s*\./ },
  { label: 'must use deploy-pages', regex: /actions\/deploy-pages@v\d+/ }
]);

for (const relative of ['Code.gs', 'AuthApi.gs', 'config.js', 'AppFrontend.js']) {
  const absolute = path.join(root, relative);
  if (!fs.existsSync(absolute)) continue;
  try {
    new vm.Script(fs.readFileSync(absolute, 'utf8'), { filename: relative });
  } catch (error) {
    failures.push(`${relative}: JavaScript syntax error: ${error.message}`);
  }
}

const leaderboardPath = path.join(root, 'Leaderboard.html');
if (fs.existsSync(leaderboardPath)) {
  const html = fs.readFileSync(leaderboardPath, 'utf8');
  const inlineScripts = [...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
    .map(match => match[1])
    .filter(source => source.trim());
  inlineScripts.forEach((source, index) => {
    try {
      new vm.Script(source, { filename: `Leaderboard.inline.${index + 1}.js` });
    } catch (error) {
      failures.push(`Leaderboard.html: inline script syntax error: ${error.message}`);
    }
  });
}

const textExtensions = new Set(['.js', '.gs', '.html', '.md', '.json', '.css']);
const forbiddenPatterns = [
  {
    label: 'hard-coded Apps Script deployment URL',
    regex: /https:\/\/script\.google\.com\/macros\/s\/[A-Za-z0-9_-]+\/exec/g,
    allowedFiles: ['config.js']
  },
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
    const normalized = relative.split(path.sep).join('/');
    for (const pattern of forbiddenPatterns) {
      if (pattern.allowedFiles && pattern.allowedFiles.includes(normalized)) continue;
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
