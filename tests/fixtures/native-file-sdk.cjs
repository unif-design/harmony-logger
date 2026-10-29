const assert = require('node:assert/strict');
const path = require('node:path');
const crypto = require('node:crypto');
const { TextEncoder } = require('node:util');
const { createLoader } = require('../../scripts/load-typescript.cjs');

const ROOT = '/data/storage/el2/base/files/TestLogs';
const LOG = 'anonymous-logs-1750000000000-00000001-test.jsonl';
const SNAPSHOT = 'anonymous-logs-snapshot-1750000000000-00000002-test.jsonl';

function sdkError(code) {
  return Object.assign(new Error('SDK fixture failure'), { code });
}

function createNativeFixture() {
  const files = new Map();
  const descriptors = new Map();
  const calls = [];
  const hooks = {};
  const controls = { chunkBytes: Infinity, nextWriteResult: undefined, listNames: undefined };
  const ioOptions = [];
  const uriCalls = [];
  let descriptor = 0;
  const uri = 'file://com.example.logger/data/storage/el2/base/files/TestLogs/sdk-reference.jsonl';

  function put(name, text = '', kind = 'file', mtime = 1750000000) {
    files.set(name, { kind, data: Buffer.from(text), mtime });
  }
  function get(name) {
    const value = files.get(name);
    if (!value) throw sdkError(13900002);
    return value;
  }
  async function visit(method, ...args) {
    calls.push({ method, args });
    if (hooks[method]) await hooks[method](...args);
  }
  const fileIo = {
    OpenMode: { READ_ONLY: 0, WRITE_ONLY: 1, CREATE: 0o100, TRUNC: 0o1000, APPEND: 0o2000, NOFOLLOW: 0o400000 },
    async mkdir(name) {
      await visit('mkdir', name);
      if (files.has(name)) throw sdkError(13900015);
      put(name, '', 'directory');
    },
    async lstat(name) {
      await visit('lstat', name);
      const value = get(name);
      return {
        size: value.data.byteLength,
        mtime: value.mtime,
        isFile: () => value.kind === 'file',
        isDirectory: () => value.kind === 'directory',
        isSymbolicLink: () => value.kind === 'symlink',
      };
    },
    async listFile(name) {
      await visit('listFile', name);
      if (controls.listNames) return controls.listNames;
      if (get(name).kind !== 'directory') throw sdkError(13900018);
      return [...files.keys()].filter((key) => key.startsWith(`${name}/`) && !key.slice(name.length + 1).includes('/')).map((key) => key.slice(name.length + 1));
    },
    async readText(name, options) {
      await visit('readText', name, options);
      assert.equal(options.encoding, 'utf-8');
      return get(name).data.toString('utf8');
    },
    async open(name, mode) {
      await visit('open', name, mode);
      assert.ok(mode & fileIo.OpenMode.NOFOLLOW, 'native writer must not follow symlinks');
      if (files.get(name)?.kind === 'symlink') throw sdkError(13900033);
      if (!files.has(name)) {
        if (!(mode & fileIo.OpenMode.CREATE)) throw sdkError(13900002);
        put(name);
      }
      const value = get(name);
      if (value.kind !== 'file') throw sdkError(13900019);
      if (mode & fileIo.OpenMode.TRUNC) value.data = Buffer.alloc(0);
      const file = { fd: ++descriptor };
      descriptors.set(file.fd, { name, position: mode & fileIo.OpenMode.APPEND ? value.data.length : 0 });
      return file;
    },
    async write(fd, input) {
      await visit('write', fd, input);
      assert.ok(input instanceof ArrayBuffer, 'short writes must slice bytes rather than UTF-16 text');
      if (controls.nextWriteResult !== undefined) return controls.nextWriteResult;
      const open = descriptors.get(fd);
      if (!open) throw sdkError(13900008);
      const chunk = Buffer.from(input).subarray(0, controls.chunkBytes);
      const value = get(open.name);
      const size = Math.max(value.data.length, open.position + chunk.length);
      const next = Buffer.alloc(size);
      value.data.copy(next);
      chunk.copy(next, open.position);
      value.data = next;
      open.position += chunk.length;
      return chunk.length;
    },
    async close(file) {
      await visit('close', file);
      if (!descriptors.delete(typeof file === 'number' ? file : file.fd)) throw sdkError(13900008);
    },
    async unlink(name) {
      await visit('unlink', name);
      get(name);
      files.delete(name);
    },
  };
  class NativeTextEncoder {
    encodeInto(text) {
      return text.length ? new TextEncoder().encode(text) : undefined;
    }
  }
  const sourceRoot = path.resolve(__dirname, '../../library/src/main/ts');
  const storeMock = { createLogFileStore: (options) => { ioOptions.push(options); return { io: options.io }; } };
  const mocks = {
    '@kit.CoreFileKit': { fileIo, fileUri: { getUriFromPath: (name) => { uriCalls.push(name); return uri; } } },
    '@kit.ArkTS': { util: { TextEncoder: NativeTextEncoder } },
    '../generated/files/createLogFileStore': storeMock,
    [path.join(sourceRoot, 'generated/files/createLogFileStore.ts')]: storeMock,
    [path.join(sourceRoot, 'native/sha256.ts')]: { __esModule: true, default: (text) => crypto.createHash('sha256').update(text).digest('hex') },
  };
  const load = createLoader(mocks);
  const { createLogFiles } = load(path.join(sourceRoot, 'native/createLogFiles.ts'));
  const options = { context: { filesDir: '/data/storage/el2/base/files' }, directoryName: 'TestLogs', createId: () => 'test' };
  function create(overrides = {}) {
    return createLogFiles({ ...options, ...overrides }).io;
  }
  return { create, createLogFiles, options, files, descriptors, calls, hooks, controls, ioOptions, put, uri, uriCalls, fileIo };
}

module.exports = { createNativeFixture, sdkError, ROOT, LOG, SNAPSHOT };
