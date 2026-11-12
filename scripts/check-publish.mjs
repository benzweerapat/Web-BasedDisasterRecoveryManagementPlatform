import { readdirSync, readFileSync, lstatSync } from 'node:fs';
import { relative, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = fileURLToPath(new URL('../', import.meta.url));
const skip = new Set(['.git', 'node_modules', 'dist', '.cache', '.vite', 'coverage', 'installers']);
const forbiddenDirs = new Set(['data', 'backups', 'previous-nosql', 'output', 'outputs', 'work', 'installers', '.claude', '.idea', '.vscode', '.aws', '.ssh']);
const tokenPatterns = [
  /AIza[\w-]{30,}/,
  /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{30,}/,
  /\bgithub_pat_[A-Za-z0-9_]{40,}/,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}/,
  /\bAKIA[0-9A-Z]{16}\b/,
  /-----BEGIN (?:RSA |EC |OPENSSH |ENCRYPTED )?PRIVATE KEY-----/
];
const privateIp = /\b(?:10\.(?:\d{1,3}\.){2}\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3})\b/;
const sensitiveAssignment = /(?:^|[{,\s])["']?(?:[A-Z_]*(?:API_KEY|PASSWORD|SESSION_SECRET|CREDENTIAL_KEY|ACCESS_TOKEN)|apiKey|password|clientSecret)["']?\s*[:=]\s*["']([^"'\r\n]+)["']/g;

export function inspect(path, data, symlink = false) {
  const name = path.split('/').at(-1);
  const parts = path.split('/');
  const issues = [];
  if (symlink) issues.push('symbolic link cannot be published');
  if (parts.some(p => forbiddenDirs.has(p) || ['node_modules', 'dist'].includes(p)) ||
      (name.startsWith('.env') && name !== '.env.example') || name.startsWith('connections.json') ||
      /\.(?:key|pem|p12|pfx|log|pid|bak|backup|zip|tar|gz|pkg|dmg|exe|bin|docx|pdf)$/.test(name) ||
      name === '.DS_Store' || name.startsWith('._')) issues.push('private/generated file must not be committed');
  const text = data.toString('utf8');
  if (tokenPatterns.some(pattern => pattern.test(text))) issues.push('possible provider token or private key');
  if (privateIp.test(text)) issues.push('private network IP; replace with a documentation address');
  if (/\/(?:Users|home)\/[^/\s"'`]+/.test(text)) issues.push('personal filesystem path');
  if (/https?:\/\/[^\s/@]+:[^\s/@]+@/.test(text)) issues.push('URL contains credentials');
  if (name === '.env.example') {
    for (const line of text.split(/\r?\n/)) {
      const entry = line.match(/^([A-Z_]*(?:SECRET|KEY|PASSWORD|USERNAME|ALLOWED_HOSTS))=(.*)$/);
      if (entry && entry[2].trim()) issues.push('sensitive example environment value must be empty');
    }
  }
  sensitiveAssignment.lastIndex = 0;
  for (const entry of text.matchAll(sensitiveAssignment)) {
    const value = entry[1];
    const testFixture = /\.test\.(?:js|mjs)$/.test(path) && /^(?:mock|test|unit-test)-/.test(value);
    if (!testFixture && !/^(?:replace-with-|<|\*{3}|\[REDACTED\])/.test(value) && !value.includes('${')) {
      issues.push('possible hardcoded credential');
    }
  }
  return [...new Set(issues)];
}

function git(args, encoding = 'utf8') {
  const r = spawnSync('git', ['-C', root, ...args], { encoding, maxBuffer: 20 * 1024 * 1024 });
  if (r.status !== 0) throw Error('Git read failed; run the check from the project repository');
  return r.stdout;
}
function walk(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(item => {
    const path = join(dir, item.name);
    if (item.isDirectory()) return skip.has(item.name) ? [] : walk(path);
    return [relative(root, path).split('\\').join('/')];
  });
}
export function main(args = process.argv.slice(2)) {
  const staged = args.includes('--staged');
  const probe = spawnSync('git', ['-C', root, 'rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  const repository = probe.status === 0 && resolve(probe.stdout.trim()) === resolve(root);
  if (staged && !repository) throw Error('--staged requires a Git repository at the project root');
  const files = repository ? git(['ls-files', '--cached', '-z']).split('\0').filter(Boolean) : walk(root);
  if (!files.length) throw Error('No publishable files found; stage the intended files first');
  const failures = [];
  for (const path of files) {
    const stat = staged ? null : lstatSync(join(root, path));
    const symlink = staged ? /^120000 /.test(git(['ls-files', '-s', '--', path])) : stat.isSymbolicLink();
    const data = staged ? git(['show', `:${path}`], null) : symlink ? Buffer.alloc(0) : readFileSync(join(root, path));
    for (const issue of inspect(path, data, symlink)) failures.push(`${path}: ${issue}`);
  }
  if (failures.length) {
    // Do not print matched secret contents in local output or CI logs.
    console.error(failures.join('\n'));
    return 1;
  }
  console.log(`Publish check passed (${files.length} ${staged ? 'indexed' : 'working-tree'} files). This pattern check does not scan Git history.`);
  return 0;
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) process.exitCode = main();
