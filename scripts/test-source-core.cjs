const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { parseArgs } = require('node:util');

const excludedSuites = {
  '__tests__/filesPlatforms.test.ts': '验证 RN Platform 与 react-native-blob-util 文件适配，HAR 不消费这些运行时。',
  '__tests__/filesWeb.test.ts': '验证 Web 内存模式及 unsupported 文件操作，不是原生文件契约。',
  '__tests__/publicEntrypoints.test.ts': '验证 npm exports 和 RN 文件 SDK 的入口加载边界，HAR 入口另验。',
  '__tests__/consoleCapture.test.ts': '直接使用 Design 后端与 Web createLogFiles 宿主，不能替换宿主后冒充原套件。',
  '__tests__/sharedBackend.test.ts': '使用 Web createLogFiles 组合默认后端，生成核心中没有该 Web 宿主。',
};
const root = path.resolve(__dirname, '..');
const hash = (data) => crypto.createHash('sha256').update(data).digest('hex');

function main() {
  const { values } = parseArgs({ options: { 'source-root': { type: 'string' } } });
  const sourceRoot = fs.realpathSync(path.resolve(values['source-root'] ?? path.join(root, '../react-native-logger')));
  const lock = JSON.parse(fs.readFileSync(path.join(root, 'logger-source.json'), 'utf8'));
  assert.match(lock.revision, /^[a-f0-9]{40}$/);
  const git = (...args) => execFileSync('git', ['-C', sourceRoot, ...args], { encoding: 'utf8' });
  assert.equal(git('rev-parse', `${lock.revision}^{commit}`).trim(), lock.revision);
  const source = (file) => execFileSync('git', ['-C', sourceRoot, 'show', `${lock.revision}:${file}`]);
  const sourcePackage = JSON.parse(source('package.json'));
  assert.equal(sourcePackage.name, '@unif/react-native-logger');
  assert.equal(sourcePackage.version, lock.version);
  const sourceRequire = createRequire(path.join(sourceRoot, 'package.json'));
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'harmony-logger-source-core-')));
  console.log(`临时回归目录: ${directory}`);
  console.log(`采用源修订: ${lock.revision}`);
  const files = [];
  function write(file, bytes, kind, original) {
    const destination = path.join(directory, file);
    fs.mkdirSync(path.dirname(destination), { recursive: true });
    fs.writeFileSync(destination, bytes, { flag: 'wx' });
    files.push({ path: file, sha256: hash(bytes), kind, ...(original ? { original } : {}) });
  }
  function copyTree(from, to, kind) {
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      assert(!entry.isSymbolicLink(), `测试输入不能是符号链接: ${path.join(from, entry.name)}`);
      if (entry.isDirectory()) copyTree(path.join(from, entry.name), `${to}/${entry.name}`, kind);
      else {
        assert(entry.isFile(), `不支持的测试输入: ${entry.name}`);
        const original = path.join(from, entry.name);
        write(`${to}/${entry.name}`, fs.readFileSync(original), kind, original);
      }
    }
  }
  copyTree(path.join(root, 'library/src/main/ts/generated'), 'src', 'generated');
  copyTree(path.join(root, 'library/src/main/ts/native'), 'native', 'native');
  // 保持 native 回引 generated 的原有布局，两个入口指向同一份测试源码。
  fs.symlinkSync('src', path.join(directory, 'generated'), 'dir');
  const sourceFiles = git('ls-tree', '-rz', '--name-only', lock.revision, '--', '__tests__').split('\0').filter(Boolean);
  const suites = sourceFiles.filter((file) => file.endsWith('.test.ts'));
  assert(suites.length > 0, '固定源修订缺少测试套件');
  for (const [file, reason] of Object.entries(excludedSuites)) {
    assert(suites.includes(file), `排除项已变更，须重新核对: ${file}`);
    console.log(`排除 ${file}: ${reason}`);
  }
  const selectedSuites = suites.filter((file) => !Object.hasOwn(excludedSuites, file));
  for (const file of sourceFiles) {
    assert(file.startsWith('__tests__/') && !file.split('/').includes('..'));
    if (Object.hasOwn(excludedSuites, file) || file === '__tests__/setup.ts') continue;
    write(file, source(file), 'source-test');
  }
  for (const helper of ['source-core-setup.cjs', 'source-core-resolver.cjs']) {
    write(`testing/${helper}`, fs.readFileSync(path.join(__dirname, 'testing', helper)), 'test-tool');
  }
  const inputs = { schemaVersion: 1, revision: lock.revision, sourceRoot, selectedSuites, excludedSuites, omittedSetup: '__tests__/setup.ts 仅注册 RN blob-util mock，不加载。', files };
  fs.writeFileSync(path.join(directory, 'inputs.json'), JSON.stringify(inputs, null, 2) + '\n');
  const resolver = require(path.join(directory, 'testing/source-core-resolver.cjs'));
  assert.throws(() => resolver('../src', {
    basedir: path.join(directory, '__tests__'),
    defaultResolver: () => path.join(sourceRoot, 'src/index.ts'),
  }), /禁止读取 RN 工作区源码/);
  const config = {
    rootDir: directory,
    testEnvironment: sourceRequire.resolve('jest-environment-node'),
    testMatch: ['<rootDir>/__tests__/**/*.test.ts'],
    setupFilesAfterEnv: ['<rootDir>/testing/source-core-setup.cjs'],
    resolver: path.join(directory, 'testing/source-core-resolver.cjs'),
    modulePaths: [path.join(sourceRoot, 'node_modules')],
    // RN 文件入口同时导出平台宿主；这些套件只消费生成的 createLogFileStore。
    moduleNameMapper: { '^\\.\\./src/files$': '<rootDir>/src/files/createLogFileStore.ts' },
    transform: {
      '^.+\\.[jt]sx?$': [sourceRequire.resolve('babel-jest'), {
        babelrc: false,
        configFile: false,
        presets: [sourceRequire.resolve('@react-native/babel-preset')],
      }],
    },
    clearMocks: true,
    restoreMocks: true,
    cacheDirectory: path.join(directory, 'jest-cache'),
    watchman: false,
  };
  const configPath = path.join(directory, 'jest.config.json');
  fs.writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n');
  const stdout = fs.openSync(path.join(directory, 'jest.stdout.log'), 'w');
  const stderr = fs.openSync(path.join(directory, 'jest.stderr.log'), 'w');
  let result;
  try {
    result = spawnSync(process.execPath, [sourceRequire.resolve('jest/bin/jest'), '--config', configPath, '--runInBand', '--json', '--outputFile', path.join(directory, 'results.json')], {
      cwd: directory,
      stdio: ['ignore', stdout, stderr],
      env: { ...process.env, NODE_ENV: 'test', BABEL_ENV: 'test' },
      timeout: 120000,
    });
  } finally {
    fs.closeSync(stdout);
    fs.closeSync(stderr);
  }
  if (result.error) throw result.error;
  assert.equal(result.signal, null, `Jest 被信号中断: ${result.signal}`);
  const report = JSON.parse(fs.readFileSync(path.join(directory, 'results.json'), 'utf8'));
  assert.equal(report.numTotalTestSuites, selectedSuites.length, '实际执行套件与选择范围不一致');
  for (const file of files) {
    assert.equal(hash(fs.readFileSync(path.join(directory, file.path))), file.sha256, `临时输入被改变: ${file.path}`);
    if (file.original) assert.equal(hash(fs.readFileSync(file.original)), file.sha256, `运行期间目标源码已变化: ${file.path}`);
  }
  const resolutions = fs.readFileSync(path.join(directory, 'resolutions.jsonl'), 'utf8').trim().split('\n').map((line) => JSON.parse(line));
  for (const required of ['src/index.ts', 'src/files/createLogFileStore.ts', 'native/sha256.ts']) {
    assert(resolutions.some((item) => item.resolved === required), `未实际加载目标核心: ${required}`);
  }
  const summary = {
    directory,
    revision: lock.revision,
    testSuites: report.numTotalTestSuites,
    failedSuites: report.numFailedTestSuites,
    passedTests: report.numPassedTests,
    failedTests: report.numFailedTests,
    pendingTests: report.numPendingTests,
  };
  fs.writeFileSync(path.join(directory, 'summary.json'), JSON.stringify(summary, null, 2) + '\n');
  console.log(`回归结果: ${JSON.stringify(summary)}`);
  console.log('原断言未修改；这是 Node 下的生成核心回归，不证明 HAR 构建或设备 SDK 行为。');
  process.exitCode = result.status === 0 && report.success ? 0 : 1;
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
