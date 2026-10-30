const test = require('node:test');
const assert = require('node:assert/strict');
const { createNativeFixture, sdkError, ROOT, LOG, SNAPSHOT } = require('./fixtures/native-file-sdk.cjs');

function hasCode(code) {
  return (error) => error.code === code;
}

test('非法目录名在任何文件 IO 前被拒绝', () => {
  const fixture = createNativeFixture();
  for (const directoryName of ['', '.', '..', '../Logs', '/Logs', 'a/b', 'a\\b', 'Logs\n', 'a'.repeat(65), null]) {
    assert.throws(() => fixture.create({ directoryName }), hasCode('logger.files.initialize_failed'));
  }
  assert.equal(fixture.calls.length, 0);
});

test('沙箱根必须是无控制字符及父目录段的绝对路径', () => {
  const fixture = createNativeFixture();
  for (const filesDir of ['', '/', 'relative', '/data/../outside', '/data/./files', '/data/files\0', '/data/files\n', undefined]) {
    assert.throws(() => fixture.create({ context: { filesDir } }), hasCode('logger.files.initialize_failed'));
  }
  assert.equal(fixture.calls.length, 0);
});

test('相同规范化根复用 IO，不同根不共享，创建时不执行 IO', () => {
  const fixture = createNativeFixture();
  const first = fixture.create();
  const second = fixture.create({ context: { filesDir: '/data//storage/el2/base/files///' } });
  const other = fixture.create({ directoryName: 'OtherLogs' });
  assert.equal(first, second);
  assert.notEqual(first, other);
  assert.equal(fixture.ioOptions[0].createId, fixture.options.createId);
  assert.equal(fixture.calls.length, 0);
});

test('已有普通目录可复用，文件或符号链接不能作为日志根', async () => {
  for (const kind of ['directory', 'file', 'symlink']) {
    const fixture = createNativeFixture();
    fixture.put(ROOT, '', kind);
    const io = fixture.create();
    if (kind === 'directory') await io.ensureRoot();
    else await assert.rejects(io.ensureRoot(), hasCode('logger.files.initialize_failed'));
  }
});

test('创建目录的权限失败和目录状态读取失败保持真实错误', async () => {
  const fixture = createNativeFixture();
  const denied = sdkError(13900012);
  fixture.put(ROOT, '', 'directory');
  fixture.hooks.mkdir = () => { throw denied; };
  await assert.rejects(fixture.create().ensureRoot(), (error) => error === denied);
  delete fixture.hooks.mkdir;
  const missing = sdkError(13900002);
  fixture.hooks.lstat = () => { throw missing; };
  await assert.rejects(fixture.create().ensureRoot(), (error) => error === missing);
});

test('列举只检查自有普通文件并将 mtime 秒转换为毫秒', async () => {
  const fixture = createNativeFixture();
  const io = fixture.create();
  await io.ensureRoot();
  fixture.put(`${ROOT}/${LOG}`, '日志\n', 'file', 1750000000.125);
  fixture.put(`${ROOT}/${SNAPSHOT}`, 'ignored', 'symlink');
  fixture.put(`${ROOT}/business.json`, 'do not inspect');
  fixture.controls.listNames = [LOG, SNAPSHOT, 'business.json', `../${LOG}`];
  fixture.calls.length = 0;
  assert.deepEqual(await io.list(), [{ name: LOG, bytes: 7, modifiedAt: 1750000000125 }]);
  assert.deepEqual(fixture.calls.filter((call) => call.method === 'lstat').map((call) => call.args[0]), [`${ROOT}/${LOG}`, `${ROOT}/${SNAPSHOT}`]);
});

test('列举中的状态读取失败不返回伪造的空摘要', async () => {
  const fixture = createNativeFixture();
  const io = fixture.create();
  await io.ensureRoot();
  fixture.put(`${ROOT}/${LOG}`, 'x');
  const failure = sdkError(13900012);
  fixture.hooks.lstat = () => { throw failure; };
  await assert.rejects(io.list(), (error) => error === failure);
});

test('列举拒绝无效文件大小和时间', async () => {
  for (const metadata of [{ size: -1, mtime: 1 }, { size: Number.MAX_SAFE_INTEGER + 1, mtime: 1 }, { size: 1, mtime: Infinity }]) {
    const fixture = createNativeFixture();
    const io = fixture.create();
    await io.ensureRoot();
    fixture.controls.listNames = [LOG];
    fixture.fileIo.lstat = async () => ({ ...metadata, isFile: () => true });
    await assert.rejects(io.list(), hasCode('logger.files.initialize_failed'));
  }
});

test('短写按 UTF-8 字节续写，追加和覆盖分别保留正确内容', async () => {
  const fixture = createNativeFixture();
  const io = fixture.create();
  await io.ensureRoot();
  fixture.controls.chunkBytes = 1;
  await io.write(LOG, '日志🙂\n');
  assert.equal(fixture.files.get(`${ROOT}/${LOG}`).data.toString('utf8'), '日志🙂\n');
  await io.append(LOG, '追加\n');
  assert.equal(fixture.files.get(`${ROOT}/${LOG}`).data.toString('utf8'), '日志🙂\n追加\n');
  await io.write(LOG, '新\n');
  assert.equal(fixture.files.get(`${ROOT}/${LOG}`).data.toString('utf8'), '新\n');
  assert.equal(fixture.descriptors.size, 0);
});

test('空快照仍创建文件并截断旧内容，不调用空串编码或写入', async () => {
  const fixture = createNativeFixture();
  const io = fixture.create();
  await io.write(SNAPSHOT, 'old');
  fixture.calls.length = 0;
  await io.write(SNAPSHOT, '');
  assert.equal(fixture.files.get(`${ROOT}/${SNAPSHOT}`).data.length, 0);
  assert.equal(fixture.calls.filter((call) => call.method === 'write').length, 0);
  assert.equal(fixture.descriptors.size, 0);
});

test('无进展或无效写入字节数拒绝且关闭描述符', async () => {
  for (const result of [0, -1, 0.5, NaN, Infinity, 99]) {
    const fixture = createNativeFixture();
    fixture.controls.nextWriteResult = result;
    await assert.rejects(fixture.create().write(LOG, 'a'), hasCode('logger.files.write_failed'));
    assert.equal(fixture.descriptors.size, 0);
    assert.equal(fixture.calls.filter((call) => call.method === 'write').length, 1);
  }
});

test('写入失败仍关闭描述符，并保留原始 SDK 错误', async () => {
  const fixture = createNativeFixture();
  const failure = sdkError(13900025);
  fixture.hooks.write = () => { throw failure; };
  await assert.rejects(fixture.create().write(LOG, 'record'), (error) => error === failure);
  assert.equal(fixture.descriptors.size, 0);
});

test('关闭失败可观察，但不能覆盖更早的写入失败', async () => {
  const fixture = createNativeFixture();
  const writeFailure = sdkError(13900025);
  const closeFailure = sdkError(13900008);
  fixture.hooks.close = () => { throw closeFailure; };
  const io = fixture.create();
  await assert.rejects(io.write(LOG, 'ok'), (error) => error === closeFailure);
  fixture.hooks.write = () => { throw writeFailure; };
  await assert.rejects(io.write(LOG, 'failed'), (error) => error === writeFailure);
  assert.equal(fixture.calls.filter((call) => call.method === 'close').length, 2);
});

test('无权或失败的 open 不尝试关闭未取得的描述符', async () => {
  const fixture = createNativeFixture();
  const failure = sdkError(13900012);
  fixture.hooks.open = () => { throw failure; };
  await assert.rejects(fixture.create().write(LOG, 'record'), (error) => error === failure);
  assert.equal(fixture.calls.filter((call) => call.method === 'close').length, 0);
});

test('越界和非自有文件不能被读取、写入或删除', async () => {
  const fixture = createNativeFixture();
  const io = fixture.create();
  for (const name of [`../${LOG}`, `nested/${LOG}`, `/outside/${LOG}`, 'business.json', `${LOG}\n`]) {
    for (const invoke of [() => io.read(name), () => io.write(name, 'x'), () => io.append(name, 'x'), () => io.remove(name)]) {
      await assert.rejects(invoke(), hasCode('logger.files.initialize_failed'));
    }
  }
  assert.equal(fixture.calls.length, 0);
});

test('读取使用真实 UTF-8 内容，文件类型或读取错误不会伪装为空内容', async () => {
  const fixture = createNativeFixture();
  const io = fixture.create();
  fixture.put(`${ROOT}/${LOG}`, '日志\n');
  assert.equal(await io.read(LOG), '日志\n');
  const failure = sdkError(13900005);
  fixture.hooks.readText = () => { throw failure; };
  await assert.rejects(io.read(LOG), (error) => error === failure);
  delete fixture.hooks.readText;
  fixture.put(`${ROOT}/${LOG}`, 'secret', 'symlink');
  await assert.rejects(io.read(LOG), hasCode('logger.files.initialize_failed'));
});

test('交付仅接受快照，返回 SDK 生成的 URI 及实际文件字节', async () => {
  const fixture = createNativeFixture();
  const io = fixture.create();
  fixture.put(`${ROOT}/${SNAPSHOT}`, '日志\n');
  assert.deepEqual(await io.getFile(SNAPSHOT), { uri: fixture.uri, bytes: 7 });
  assert.deepEqual(fixture.uriCalls, [`${ROOT}/${SNAPSHOT}`]);
  fixture.calls.length = 0;
  await assert.rejects(io.getFile(LOG), hasCode('logger.files.snapshot_invalid'));
  assert.equal(fixture.calls.length, 0);
});

test('快照的 stat 失败和非法大小不能成为有效交付', async () => {
  const fixture = createNativeFixture();
  const io = fixture.create();
  const failure = sdkError(13900012);
  fixture.hooks.lstat = () => { throw failure; };
  await assert.rejects(io.getFile(SNAPSHOT), (error) => error === failure);
  delete fixture.hooks.lstat;
  fixture.fileIo.lstat = async () => ({ isFile: () => true, size: -1 });
  await assert.rejects(io.getFile(SNAPSHOT), hasCode('logger.files.snapshot_failed'));
  assert.equal(fixture.uriCalls.length, 0);
});

test('删除不存在文件可重复完成，其他失败按原错误拒绝', async () => {
  const fixture = createNativeFixture();
  const io = fixture.create();
  fixture.put(`${ROOT}/${SNAPSHOT}`, 'owned');
  await io.remove(SNAPSHOT);
  await io.remove(SNAPSHOT);
  assert.equal(fixture.files.has(`${ROOT}/${SNAPSHOT}`), false);
  for (const code of [13900012, 13900005, '13900002']) {
    const failure = sdkError(code);
    fixture.hooks.unlink = () => { throw failure; };
    await assert.rejects(io.remove(SNAPSHOT), (error) => error === failure);
  }
});
