import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

// QA audit: traceability (OpenSpec scenario -> test) and test-rule conformance.
const root = process.cwd();
const walk = (dir, out = []) => {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === 'dist' || name.startsWith('.git')) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, out);
    else out.push(path);
  }
  return out;
};
const read = file => readFileSync(file, 'utf8');
const specFiles = walk(join(root, 'openspec/specs')).filter(file => file.endsWith('.feature'));
const scenarios = new Map(); // id -> { file, title }
for (const file of specFiles) {
  const lines = read(file).split('\n');
  lines.forEach((line, index) => {
    for (const id of line.match(/@BSH-[A-Z0-9]+-\d+/g) ?? []) {
      const title = (lines.slice(index, index + 3).find(next => /Cen[áa]rio/.test(next)) ?? '').trim();
      scenarios.set(id.slice(1), { file: relative(root, file), title });
    }
  });
}
const testFiles = walk(join(root, 'test')).filter(file => /\.(test\.(mjs|ts)|py)$/.test(file) || file.includes('e2e'));
const unitTests = walk(join(root, 'test')).filter(file => /\.test\.(mjs|ts)$/.test(file));
const referenced = new Map();
for (const file of [...testFiles, ...walk(join(root, 'scripts')).filter(f => /\.(py|mjs)$/.test(f))]) {
  for (const id of read(file).match(/BSH-[A-Z0-9]+-\d+/g) ?? []) {
    if (!referenced.has(id)) referenced.set(id, new Set());
    referenced.get(id).add(relative(root, file));
  }
}
const uncovered = [...scenarios].filter(([id]) => !referenced.has(id));
const orphanRefs = [...referenced.keys()].filter(id => !scenarios.has(id));
const violations = [];
for (const file of unitTests) {
  const source = read(file);
  const rel = relative(root, file);
  const names = [...source.matchAll(/\b(?:test|it)\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g)].map(match => match[2]);
  const nonGwt = names.filter(name => !/Given .* When .* Then /.test(name));
  if (nonGwt.length) violations.push({ rule: 'given-when-then-name', file: rel, count: nonGwt.length, total: names.length });
  if (/\b(tsx|ts-node)\b|node\s+src\//.test(source)) violations.push({ rule: 'runs-source-not-binary', file: rel });
  if (/\.skip\(|\bit\.todo|test\.todo|\.only\(/.test(source)) violations.push({ rule: 'skipped-or-only', file: rel });
  if (names.length && !/assert|expect/.test(source)) violations.push({ rule: 'no-assertions', file: rel });
}
const byDomain = {};
for (const [id, info] of scenarios) {
  const key = info.file.replace('openspec/specs/', '');
  byDomain[key] ??= { total: 0, covered: 0 };
  byDomain[key].total++;
  if (referenced.has(id)) byDomain[key].covered++;
}
const report = { scenarios: scenarios.size, covered: scenarios.size - uncovered.length, uncovered: uncovered.map(([id, info]) => ({ id, ...info })), orphanRefs, violations, byDomain, unitTestFiles: unitTests.length };
writeFileSync(join(root, 'evaluation/qa-audit.json'), `${JSON.stringify(report, null, 2)}\n`);
console.log(`scenarios=${report.scenarios} covered=${report.covered} uncovered=${uncovered.length} orphanRefs=${orphanRefs.length} violations=${violations.length}`);
for (const [domain, stat] of Object.entries(byDomain)) console.log(`${domain}: ${stat.covered}/${stat.total}`);
const rules = {};
for (const violation of violations) rules[violation.rule] = (rules[violation.rule] ?? 0) + 1;
console.log(JSON.stringify(rules));
