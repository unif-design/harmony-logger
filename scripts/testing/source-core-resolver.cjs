const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const inputs = JSON.parse(fs.readFileSync(path.join(root, 'inputs.json'), 'utf8'));
const hashes = new Map(inputs.files.map((file) => [file.path, file.sha256]));

module.exports = (request, options) => {
  assert(!/^(?:react-native(?:\/|$)|react-native-blob-util(?:\/|$)|@unif\/react-native-design(?:\/|$)|crypto-js(?:\/|$)|lodash(?:\/|$))/.test(request), `核心回归不得加载平台或已替换依赖: ${request}`);
  const resolved = options.defaultResolver(request, options);
  if (!path.isAbsolute(resolved)) return resolved;
  const filename = fs.realpathSync(resolved);
  const original = path.relative(inputs.sourceRoot, filename);
  assert(original.startsWith('..' + path.sep) || path.isAbsolute(original) || original.startsWith('node_modules' + path.sep), `禁止读取 RN 工作区源码: ${filename}`);
  const relative = path.relative(root, filename).split(path.sep).join('/');
  if (relative.startsWith('src/') || relative.startsWith('native/')) {
    assert(hashes.has(relative), `目标核心未登记: ${relative}`);
    const sha256 = crypto.createHash('sha256').update(fs.readFileSync(filename)).digest('hex');
    assert.equal(sha256, hashes.get(relative), `目标核心副本哈希不匹配: ${relative}`);
    fs.appendFileSync(path.join(root, 'resolutions.jsonl'), JSON.stringify({ request, from: path.relative(root, options.basedir), resolved: relative, sha256 }) + '\n');
  }
  return resolved;
};
