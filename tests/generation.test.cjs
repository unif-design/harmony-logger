const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const test = require('node:test');

const root = path.resolve(__dirname, '..');

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'logger-generation-test-'));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  const sourceRoot = path.join(directory, 'source');
  const targetRoot = path.join(directory, 'target');
  function write(file, text) {
    const destination = path.join(directory, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, text);
  }
  write('source/package.json', JSON.stringify({ name: '@unif/react-native-logger', version: '0.1.3' }));
  write('source/src/index.ts', "export { digest } from './digest';\n");
  write('source/src/digest.ts', "import sha256 from 'crypto-js/sha256.js';\nexport const digest = sha256;\n");
  write('source/src/files/createLogFileStore.ts', "export function invalid(reference: { uri: string }) { return !reference.uri.startsWith('file:///'); }\n");
  write('source/docs/FORMAT.md', '---\ntitle: Fixture\n---\n\n# Shared format\n');
  write('target/library/oh-package.json5', JSON.stringify({ version: '0.1.3' }));
  write('target/library/src/main/ts/native/sha256.ts', '// Native leaf fixture.\n');
  write('target/scripts/sync-core.cjs', fs.readFileSync(path.join(root, 'scripts/sync-core.cjs'), 'utf8'));
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(targetRoot, 'node_modules'), 'dir');
  const git = (...args) => execFileSync('git', ['-C', sourceRoot, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  git('init', '--quiet');
  function commitSource() {
    git('add', '.');
    git('-c', 'user.name=Fixture', '-c', 'user.email=fixture@example.invalid', '-c', 'commit.gpgsign=false', 'commit', '--quiet', '-m', 'test fixture');
    const revision = git('rev-parse', 'HEAD').trim();
    write('target/logger-source.json', JSON.stringify({ revision, version: '0.1.3', roots: ['src/index.ts', 'src/files/createLogFileStore.ts'] }));
  }
  commitSource();
  function run(...args) {
    const result = spawnSync(process.execPath, [path.join(targetRoot, 'scripts/sync-core.cjs'), '--source-root', sourceRoot, ...args], { encoding: 'utf8' });
    assert.ifError(result.error);
    return { status: result.status, text: result.stdout + result.stderr };
  }
  function read(file) { return fs.readFileSync(path.join(targetRoot, file), 'utf8'); }
  function contents() {
    const files = {};
    function walk(directory) {
      for (const item of fs.readdirSync(directory, { withFileTypes: true })) {
        const file = path.join(directory, item.name);
        if (item.isDirectory()) walk(file);
        else files[path.relative(targetRoot, file)] = fs.readFileSync(file, 'utf8');
      }
    }
    walk(path.join(targetRoot, 'library'));
    return files;
  }
  return { write, read, run, contents, commitSource };
}

test('固定源生成完整依赖与格式文档，重复生成结果一致', (t) => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  const first = f.contents();
  assert.match(f.read('library/src/main/ts/generated/digest.ts'), /from '\.\.\/native\/sha256'/);
  assert.match(f.read('library/FORMAT.md'), /# Shared format/);
  assert.doesNotMatch(f.read('library/FORMAT.md'), /title: Fixture/);
  const provenance = JSON.parse(f.read('library/src/main/resources/rawfile/logger-provenance.json'));
  assert.equal(provenance.inputs.length, 3);
  assert.equal(provenance.documents[0].path, 'docs/FORMAT.md');
  assert.equal(f.run().status, 0);
  assert.deepEqual(f.contents(), first);
  assert.equal(f.run('--check').status, 0);
});

test('只读校验报告生成漂移，不修复或写入文件', (t) => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  f.write('target/library/Index.ts', f.read('library/Index.ts') + '// drift\n');
  const before = f.contents();
  const result = f.run('--check');
  assert.notEqual(result.status, 0);
  assert.match(result.text, /Generated core differs/);
  assert.deepEqual(f.contents(), before);
});

test('发现手写目标或过期目录中的手写文件时，拒绝任何局部覆盖和删除', (t) => {
  for (const file of ['library/src/main/ts/generated/manual.ts', 'library/Index.ts', 'library/FORMAT.md']) {
    const f = fixture(t);
    assert.equal(f.run().status, 0);
    f.write(`target/${file}`, 'manual content\n');
    const before = f.contents();
    const result = f.run();
    assert.notEqual(result.status, 0);
    assert.match(result.text, /Refusing to (remove|overwrite) hand-written file/);
    assert.deepEqual(f.contents(), before);
  }
});

test('版本不匹配在改动生成物前失败', (t) => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  f.write('target/library/oh-package.json5', JSON.stringify({ version: '0.1.4' }));
  const before = f.contents();
  assert.notEqual(f.run().status, 0);
  assert.deepEqual(f.contents(), before);
});

test('源新增未支持的外部依赖时失败，不留下混合版本产物', (t) => {
  const f = fixture(t);
  assert.equal(f.run().status, 0);
  f.write('source/src/digest.ts', "export { digest } from 'unexpected-runtime';\n");
  f.commitSource();
  const before = f.contents();
  const result = f.run();
  assert.notEqual(result.status, 0);
  assert.match(result.text, /Unsupported dependency: unexpected-runtime/);
  assert.deepEqual(f.contents(), before);
});
