const fs = require('node:fs');
const path = require('node:path');

const ALLOWED = new Set(['MIT', 'Apache-2.0', 'BSD-2-Clause', 'BSD-3-Clause', 'ISC']);

function primary(tokens, index, depth) {
  if (depth > 32 || index >= tokens.length) throw new Error('Invalid license expression');
  if (tokens[index] === '(') {
    const [allowed, next] = expression(tokens, index + 1, depth + 1);
    if (tokens[next] !== ')') throw new Error('Unclosed license expression');
    return [allowed, next + 1];
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9.+-]*$/.test(tokens[index]) ||
      ['AND', 'OR', 'WITH'].includes(tokens[index])) {
    throw new Error('Invalid license identifier');
  }
  return [ALLOWED.has(tokens[index]), index + 1];
}

function conjunction(tokens, index, depth) {
  let [allowed, next] = primary(tokens, index, depth);
  while (tokens[next] === 'AND') {
    const [right, after] = primary(tokens, next + 1, depth);
    allowed = allowed && right;
    next = after;
  }
  return [allowed, next];
}

function expression(tokens, index = 0, depth = 0) {
  let [allowed, next] = conjunction(tokens, index, depth);
  while (tokens[next] === 'OR') {
    const [right, after] = conjunction(tokens, next + 1, depth);
    allowed = allowed || right;
    next = after;
  }
  return [allowed, next];
}

function isAllowedLicense(license) {
  if (Array.isArray(license)) {
    // Legacy license arrays do not identify the relationship between licenses.
    return license.length > 0 && license.every((item) =>
      typeof item === 'string' && isAllowedLicense(item));
  }
  if (typeof license !== 'string' || !license.trim() || license.length > 2048) return false;
  const tokens = license.trim().match(/\(|\)|[^\s()]+/g);
  if (!tokens || tokens.length > 256) return false;
  try {
    const [allowed, next] = expression(tokens);
    return allowed && next === tokens.length;
  } catch {
    return false;
  }
}

function evaluateLicenses(report, projectRoot, requiredPackages = []) {
  if (!report || typeof report !== 'object' || Array.isArray(report) ||
      Object.keys(report).length === 0) throw new Error('Empty or invalid license inventory');
  const application = path.resolve(projectRoot);
  const entries = Object.entries(report).map(([name, detail]) => {
    if (!/^(@[^/]+\/)?[^@/]+@.+$/.test(name) || !detail ||
        typeof detail !== 'object' || Array.isArray(detail) || typeof detail.path !== 'string') {
      throw new Error(`Invalid license inventory entry: ${name}`);
    }
    return { name, detail, application: path.resolve(detail.path) === application };
  }).filter((entry) => !entry.application);
  const missing = requiredPackages.filter((name) =>
    !entries.some((entry) => entry.name.startsWith(`${name}@`)));
  if (missing.length) throw new Error(`License inventory missing direct dependencies: ${missing.join(', ')}`);
  return {
    checked: entries.length,
    rejected: entries.filter(({ detail }) => !isAllowedLicense(detail.licenses))
      .map(({ name, detail }) => ({ name, licenses: detail.licenses ?? 'UNKNOWN' })),
  };
}

function main(args) {
  if (args.length !== 2) throw new Error('Usage: node scripts/license-policy.cjs REPORT PROJECT_DIRECTORY');
  const [reportFile, projectRoot] = args;
  const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8'));
  const dependencies = [...Object.keys(manifest.dependencies || {}),
    ...Object.keys(manifest.optionalDependencies || {})];
  const report = JSON.parse(fs.readFileSync(reportFile, 'utf8'));
  const result = evaluateLicenses(report, projectRoot, dependencies);
  console.log(`Checked ${result.checked} production dependency licenses.`);
  for (const { name, licenses } of result.rejected) {
    console.error(`Disallowed or unknown license: ${name}: ${JSON.stringify(licenses)}`);
  }
  return result.rejected.length ? 1 : 0;
}

if (require.main === module) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    console.error(`License audit failed: ${error.message}`);
    process.exitCode = 2;
  }
}

module.exports = { isAllowedLicense, evaluateLicenses };
