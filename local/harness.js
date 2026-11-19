#!/usr/bin/env node
/**
 * Runs the Apps Script code (src/*.js) locally in Node, with small stand-ins for Google services.
 * Used to tune the prompt and run the test suite before pushing.
 *
 *   node local/harness.js test            # all TEST_CASES
 *   node local/harness.js test S1 T05     # selected cases
 *   node local/harness.js chat KV1003     # interactive chat as an employee
 *
 * Needs .env with OPENROUTER_API_KEY (and optionally OPENROUTER_MODEL). Nothing is written to a Sheet.
 */
const fs = require('fs'), os = require('os'), path = require('path'), vm = require('vm'), crypto = require('crypto');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const env = Object.fromEntries(fs.readFileSync(path.join(root, '.env'), 'utf8').split('\n')
  .filter(l => l.includes('=')).map(l => [l.slice(0, l.indexOf('=')).trim(), l.slice(l.indexOf('=') + 1).trim()]));

const cache = new Map();
const ctx = {
  console,
  PropertiesService: { getScriptProperties: () => ({ getProperty: k => env[k] || null }) },
  CacheService: { getScriptCache: () => ({ get: k => cache.get(k) || null, put: (k, v) => cache.set(k, v) }) },
  Utilities: {
    getUuid: () => crypto.randomUUID(),
    sleep: ms => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms),
  },
  // Synchronous HTTP like UrlFetchApp, via curl. Headers go through a 0600 temp file so the key never shows in `ps`.
  UrlFetchApp: {
    fetch(url, o) {
      const hdr = path.join(os.tmpdir(), `kv-h-${process.pid}`);
      fs.writeFileSync(hdr, Object.entries(Object.assign({ 'Content-Type': o.contentType }, o.headers)).map(([k, v]) => `${k}: ${v}`).join('\n'), { mode: 0o600 });
      try {
        const out = execFileSync('curl', ['-s', '-X', 'POST', url, '-H', '@' + hdr, '--data-binary', '@-', '-w', '\n%{http_code}', '--max-time', '90'],
          { input: o.payload, maxBuffer: 10 * 1024 * 1024 }).toString();
        const i = out.lastIndexOf('\n');
        return { getResponseCode: () => Number(out.slice(i + 1)), getContentText: () => out.slice(0, i) };
      } finally { fs.rmSync(hdr, { force: true }); }
    },
  },
};
vm.createContext(ctx);
const src = ['policy.js', 'roster.js', 'Code.js', 'tests.js'].map(f => fs.readFileSync(path.join(root, 'src', f), 'utf8')).join('\n');
vm.runInContext(src + '\n;this.__ = { TEST_CASES, ROSTER_CSV };', ctx);

// Roster lookup from the CSV instead of the Sheet tab.
const [head, ...rows] = ctx.__.ROSTER_CSV.trim().split('\n').map(l => l.split(','));
ctx.findEmployee_ = id => {
  const r = rows.find(x => x[0] === id);
  return r ? Object.fromEntries(head.map((k, i) => [k, r[i]])) : null;
};

const [mode, ...args] = process.argv.slice(2);
if (mode === 'md') { // markdown results table, e.g. node local/harness.js md S1 S2 S3 S4 S5 S6 > docs/sample-results.md
  const cases = ctx.__.TEST_CASES.filter(c => !args.length || args.includes(c.id));
  const cell = s => String(s).replace(/\|/g, '\\|').replace(/\n+/g, '<br>');
  console.log('| # | Employee | Question | Bot reply (actual) | Type | Flags | Result |\n|---|---|---|---|---|---|---|');
  for (const c of cases) {
    const [r] = ctx.runTestCases_([c]);
    console.log(`| ${r[0]} | ${r[1]} | ${cell(r[2])} | ${cell(r[4])} | ${r[5]} | ${r[6] || '—'} | ${r[7] === 'PASS' ? '✅' : '❌ ' + cell(r[8])} |`);
  }
} else if (mode === 'test') {
  const cases = args.length ? ctx.__.TEST_CASES.filter(c => args.includes(c.id)) : ctx.__.TEST_CASES;
  let pass = 0;
  for (const c of cases) {
    const t = Date.now();
    const [row] = ctx.runTestCases_([c]);
    if (row[7] === 'PASS') pass++;
    console.log(`\n${row[7] === 'PASS' ? '✅' : '❌'} ${row[0]} ${row[1]} (${Date.now() - t} ms) — ${row[2]}`);
    console.log(`   [${row[5]}] [${row[6]}] ${row[4].replace(/\n/g, '\n   ')}`);
    if (row[8]) console.log(`   WHY: ${row[8]}`);
  }
  console.log(`\nScore: ${pass}/${cases.length}`);
} else if (mode === 'chat') {
  const start = ctx.startChat(args[0] || '', args[1] === 'guest', true);
  console.log(start.greeting || start.error);
  if (!start.ok) process.exit(1);
  const rl = require('readline').createInterface({ input: process.stdin, output: process.stdout, prompt: '\nyou> ' });
  rl.prompt();
  rl.on('line', line => {
    const r = ctx.chat(start.sessionId, line);
    console.log(`bot [${r.answer_type}] [${(r.flags || []).join(', ')}]${r.note ? ' {' + r.note + '}' : ''}\n${r.reply}`);
    rl.prompt();
  });
} else {
  console.log('Usage: node local/harness.js test [ids...] | chat <EMPLOYEE_ID> [guest]');
}
