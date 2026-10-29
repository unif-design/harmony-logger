const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const path = require('node:path');
const test = require('node:test');
const { TextEncoder } = require('node:util');
const { createLoader } = require('../scripts/load-typescript.cjs');
const source = (name) => path.resolve(__dirname, '../library/src/main/ts', name);

function platform() {
  const clock = { ticks: 100, reads: 0 };
  const load = createLoader({
    '@kit.ArkTS': { util: { TextEncoder: class { encodeInto(text) { return new TextEncoder().encode(text); } } } },
    '@kit.CryptoArchitectureKit': { cryptoFramework: { createMd(name) {
      assert.equal(name, 'SHA256');
      const hash = crypto.createHash('sha256');
      return { updateSync({ data }) { hash.update(data); }, digestSync() { return { data: new Uint8Array(hash.digest()) }; } };
    } } },
    '@kit.BasicServicesKit': { systemDateTime: { TimeType: { ACTIVE: 1 }, getUptime(kind, nano) { assert.equal(kind, 1); assert.equal(nano, false); clock.reads++; return clock.ticks; } } },
  });
  return { load, clock };
}

function backend(consoleTarget) {
  const transports = new Map();
  let currentLevel = 'warn';
  const consoleTransport = { id: 'test-console', log(record) { consoleTarget?.[record.level]?.(record.message, ...record.args); } };
  if (consoleTarget) transports.set(consoleTransport.id, consoleTransport);
  return {
    consoleTransport,
    createLogger(scope) {
      return Object.fromEntries(['debug', 'info', 'warn', 'error'].map((level) => [level, (message, ...args) => {
        for (const transport of transports.values()) transport.log({ scope, level, message, args, timestamp: Date.now() });
      }]));
    },
    addTransport(value) { transports.set(value.id, value); },
    removeTransport(id) { transports.delete(id); },
    getLogLevel() { return currentLevel; },
    setLogLevel(value) { currentLevel = value; },
  };
}

async function fixture({ capture = false } = {}) {
  const { load, clock } = platform();
  const disk = new Map();
  let id = 0;
  let removeFailure = false;
  const now = () => Date.parse('2026-10-29T00:00:00.000Z');
  const io = {
    async ensureRoot() {},
    async list() { return [...disk].map(([name, text]) => ({ name, bytes: Buffer.byteLength(text), modifiedAt: now() })); },
    async read(name) { if (!disk.has(name)) throw new Error('missing'); return disk.get(name); },
    async write(name, text) { disk.set(name, text); },
    async append(name, text) { disk.set(name, (disk.get(name) ?? '') + text); },
    async remove(name) { if (removeFailure) { removeFailure = false; throw new Error('remove failed'); } disk.delete(name); },
    async getFile(name) { return { uri: `file://org.unif.logger.example/data/storage/el2/base/files/Logs/${name}`, bytes: Buffer.byteLength(disk.get(name)) }; },
  };
  const createId = () => `fixture-${++id}`;
  const files = load(source('generated/files/createLogFileStore.ts')).createLogFileStore({ io, now, createId });
  const printed = [];
  const target = Object.fromEntries(['debug', 'log', 'info', 'warn', 'error'].map((level) => [level, (...args) => printed.push({ level, args })]));
  const sdk = backend(capture ? target : undefined);
  const options = {
    policy: { service: 'logger-example', allowedFields: ['reason', 'count'], startupScopes: ['bootstrap'] },
    environment: { appVersion: '0.1.0', platform: 'harmony', osVersion: 'fixture', development: true },
    files, createId, now, backend: sdk,
    ...(capture ? { console: { target, transport: sdk.consoleTransport }, consoleTimeZone: 'Asia/Shanghai' } : {}),
  };
  const handle = load(source('native/installLogging.ts')).installLogging(options);
  const core = load(source('generated/index.ts'));
  await handle.setOwner(null);
  return { load, clock, disk, files, handle, core, options, target, printed, sdk, failRemove() { removeFailure = true; } };
}

test('UTF-8 字节数和同步摘要与采用源契约一致', () => {
  const { load } = platform();
  const utf8 = load(source('native/utf8.ts')).default;
  const sha256 = load(source('native/sha256.ts')).default;
  for (const text of ['', 'plain', '中文🙂', '\u0000\n', 'e\u0301']) {
    assert.equal(utf8.parse(text).sigBytes, Buffer.byteLength(text));
    assert.equal(sha256(text), crypto.createHash('sha256').update(text).digest('hex'));
  }
  assert.throws(() => utf8.parse('\ud800'), URIError);
  assert.throws(() => sha256('\ud800'), URIError);
});

test('自有属性检查支持无原型对象且不调用访问器或同名伪造方法', () => {
  const { hasOwn } = platform().load(source('native/ownProperty.ts'));
  const object = Object.create(null);
  Object.defineProperty(object, 'secret', { get() { throw new Error('must not run'); } });
  object.hasOwnProperty = () => { throw new Error('must not run'); };
  assert.equal(hasOwn(object, 'secret'), true);
  assert.equal(hasOwn(object, 'missing'), false);
  assert.equal(hasOwn({}, 'toString'), false);
  assert.throws(() => hasOwn(null, 'x'), TypeError);
});

test('原生 file URI 支持 bundleName，同时拒绝错误协议和路径逃逸', () => {
  const { isLogFileUri } = platform().load(source('native/fileUri.ts'));
  for (const uri of ['file:///data/storage/el2/base/files/a.jsonl', 'file://org.unif.app/data/storage/a%20b.jsonl']) assert.equal(isLogFileUri(uri), true, uri);
  for (const uri of ['http://host/a', 'content://host/a', 'file://relative', 'file://../path', 'file:///a/../b', 'file:///a/%2e%2e/b', 'file:///a%00b', 'file:///a\\b', 'file:///a?secret=1', 'file:///a#x', 'file:///a%ZZ']) assert.equal(isLogFileUri(uri), false, uri);
});

test('鸿蒙沙箱路径会脱敏且保留真实 ets 位置', () => {
  const { load } = platform();
  const { redactDiagnosticText, getFailureDiagnostics } = load(source('generated/index.ts'));
  const text = redactDiagnosticText('read /data/storage/el2/base/files/Logs/a.jsonl token=demo-secret');
  assert.equal(text.includes('/data/storage'), false);
  assert.equal(text.includes('demo-secret'), false);
  const error = new Error('storage failed');
  // Error.stack may be an accessor; use a data-property fixture and test getter rejection separately.
  Object.defineProperty(error, 'stack', { value: 'Error: storage failed\n    at save (/data/storage/el2/base/files/Save.ets:42:9)' });
  const details = getFailureDiagnostics(error);
  assert.deepEqual(details.errorSource, { file: 'Save.ets', line: 42, column: 9, functionName: 'save' });
  assert.equal(JSON.stringify(details).includes('/data/storage'), false);
  let reads = 0;
  const guarded = { name: 'Error', message: 'storage failed' };
  Object.defineProperty(guarded, 'stack', { get() { reads++; return error.stack; } });
  assert.equal(getFailureDiagnostics(guarded).errorSource, undefined);
  assert.equal(reads, 0);

});

test('默认使用系统单调时钟且不改调用方 options 或结构化 UTC 时间', async () => {
  const f = await fixture();
  try {
    const context = f.core.createOperationContext('user');
    f.clock.ticks = 137;
    const line = f.core.createLogger('sample').captureError('sample.failed', { context, fields: { reason: 'test', count: 1 } });
    const record = JSON.parse(line);
    assert.equal(record.durationMs, 37);
    assert.equal(record.timestamp, '2026-10-29T00:00:00.000Z');
    assert.equal(f.options.monotonicNow, undefined);
    assert.ok(f.clock.reads >= 2);
  } finally { f.handle.dispose(); }
});

test('clear 清理源日志与队列，活跃快照继续可读直至显式释放', async () => {
  const f = await fixture();
  try {
    f.core.createLogger('sample').info('sample.ready', { fields: { count: 1 } });
    const snapshot = await f.handle.createSnapshot();
    const content = await f.handle.readSnapshot(snapshot);
    assert.ok(content.includes('sample.ready'));
    assert.deepEqual(await f.handle.clear(), { status: 'success' });
    assert.deepEqual(await f.handle.readSummary(), { fileCount: 0, bytes: 0 });
    assert.equal(await f.handle.readSnapshot(snapshot), content);
    await f.handle.releaseSnapshot(snapshot);
    await assert.rejects(f.handle.readSnapshot(snapshot), { code: 'logger.files.snapshot_invalid' });
  } finally { f.handle.dispose(); }
});

test('身份 A→B→A 不恢复旧上下文或旧快照，对象副本不能冒充原句柄', async () => {
  const f = await fixture();
  try {
    await f.handle.setOwner('owner-a');
    const context = f.core.createOperationContext('user');
    const snapshot = await f.handle.createSnapshot();
    await assert.rejects(f.handle.readSnapshot({ ...snapshot }), { code: 'logger.files.snapshot_invalid' });
    await f.handle.setOwner('owner-b');
    await f.handle.setOwner('owner-a');
    assert.equal(f.core.createLogger('sample').captureError('stale', { context }), null);
    await assert.rejects(f.handle.readSnapshot(snapshot), { code: 'logger.files.snapshot_invalid' });
  } finally { f.handle.dispose(); }
});

test('SDK URI 快照可交付，释放失败可重试并跨身份/销毁保持接收方所有权', async () => {
  const f = await fixture();
  f.core.createLogger('sample').info('handoff');
  const snapshot = await f.handle.createSnapshot();
  const file = await f.handle.takeSnapshotFile(snapshot);
  assert.ok(file.uri.startsWith('file://org.unif.logger.example/'));
  await assert.rejects(f.handle.readSnapshot(snapshot), { code: 'logger.files.snapshot_invalid' });
  f.failRemove();
  await assert.rejects(file.release());
  await f.handle.setOwner('another-owner');
  f.handle.dispose();
  assert.ok([...f.disk.keys()].some((name) => name.includes('logs-snapshot')));
  await file.release();
  await file.release();
  assert.equal([...f.disk.keys()].some((name) => name.includes('logs-snapshot')), false);
});

test('显式 console 采集有界、脱敏，并保留后安装的包装', async () => {
  const f = await fixture({ capture: true });
  try {
    f.target.warn('token=demo-secret /data/storage/el2/base/files/private.json');
    await f.handle.flush();
    const snapshot = await f.handle.createSnapshot();
    const content = await f.handle.readSnapshot(snapshot);
    assert.equal(content.includes('demo-secret'), false);
    assert.equal(content.includes('/data/storage'), false);
    assert.ok(f.printed.length > 0 && f.printed.length < 5);
    await f.handle.releaseSnapshot(snapshot);
    const replacement = () => {};
    f.target.warn = replacement;
    f.handle.dispose();
    assert.equal(f.target.warn, replacement);
    assert.equal(f.sdk.getLogLevel(), 'warn');
  } finally { f.handle.dispose(); }
});

test('原生文件错误保留数值原码，原因链选择最深已知错误', () => {
  const { getFailureDiagnostics } = platform().load(source('generated/index.ts'));
  const value = getFailureDiagnostics({ name: 'Error', code: 13900005, cause: { name: 'Error', code: 13900025 } });
  assert.equal(value.reason, 'storage_full');
  assert.equal(value.sourceCode, 13900005);
  assert.equal(value.causeCode, 13900025);
  assert.equal(getFailureDiagnostics({ name: 'Error', code: 13900012 }).reason, 'permission_denied');
  assert.equal(getFailureDiagnostics({ name: 'Error', code: 13900027 }).reason, 'read_only');
  assert.equal(getFailureDiagnostics({ name: 'Error', code: 201 }).reason, 'unknown');
  assert.equal(getFailureDiagnostics({ name: 'Error', code: 13900013 }).reason, 'unknown');
});
