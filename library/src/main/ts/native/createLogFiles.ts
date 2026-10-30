import { fileIo, fileUri } from '@kit.CoreFileKit';
import { util } from '@kit.ArkTS';
import { createLogFileStore } from '../generated/files/createLogFileStore';
import { LOG_FILE_FAILURES } from '../generated/files/constants';
import { createLogFileError } from '../generated/files/createLogFileError';
import { isOwnedFileName, isSnapshotFileName } from '../generated/files/fileNames';
import type { LogFileIO, LogFileInfo, LogFileStore } from '../generated/files/types';
import type { NativeLogFilesOptions } from './types';

export type { NativeLogFilesOptions } from './types';

const nativeRoots = new Map<string, LogFileIO>();

function hasErrorCode(error: unknown, code: number): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === code;
}

export function createLogFiles(options: NativeLogFilesOptions): LogFileStore {
  const directoryName = options.directoryName;
  const base = options.context?.filesDir;
  if (
    typeof directoryName !== 'string' ||
    /^[a-zA-Z0-9][a-zA-Z0-9_.-]{0,63}$/.exec(directoryName)?.[0] !== directoryName ||
    typeof base !== 'string' ||
    !base.startsWith('/') ||
    /[\u0000-\u001f\u007f\\]/.test(base) ||
    base.split('/').some((part) => part === '.' || part === '..')
  ) {
    throw createLogFileError(LOG_FILE_FAILURES.initialize);
  }
  const normalizedBase = `/${base.split('/').filter(Boolean).join('/')}`;
  if (normalizedBase === '/') throw createLogFileError(LOG_FILE_FAILURES.initialize);
  const root = `${normalizedBase}/${directoryName}`;
  const existing = nativeRoots.get(root);
  if (existing) return createLogFileStore({ io: existing, createId: options.createId });

  function path(name: string): string {
    if (typeof name !== 'string' || !isOwnedFileName(name)) {
      throw createLogFileError(LOG_FILE_FAILURES.initialize);
    }
    return `${root}/${name}`;
  }

  async function writeText(name: string, text: string, append: boolean): Promise<void> {
    const location = path(name);
    const data = text.length ? new util.TextEncoder('utf-8').encodeInto(text) : new Uint8Array(0);
    const file = await fileIo.open(
      location,
      fileIo.OpenMode.WRITE_ONLY | fileIo.OpenMode.CREATE | fileIo.OpenMode.NOFOLLOW |
        (append ? fileIo.OpenMode.APPEND : fileIo.OpenMode.TRUNC),
    );
    let failed = false;
    try {
      let written = 0;
      while (written < data.byteLength) {
        const count = await fileIo.write(file.fd, data.slice(written).buffer as ArrayBuffer);
        if (!Number.isSafeInteger(count) || count <= 0 || count > data.byteLength - written) {
          throw createLogFileError(LOG_FILE_FAILURES.write);
        }
        written += count;
      }
    } catch (error) {
      failed = true;
      throw error;
    } finally {
      try {
        await fileIo.close(file);
      } catch (error) {
        // 关闭仍需尝试，但不能覆盖先发生的写入错误。
        if (!failed) throw error;
      }
    }
  }

  const io: LogFileIO = {
    async ensureRoot() {
      try {
        await fileIo.mkdir(root);
      } catch (error) {
        if (!hasErrorCode(error, 13900015)) throw error;
      }
      const stat = await fileIo.lstat(root);
      if (!stat.isDirectory()) throw createLogFileError(LOG_FILE_FAILURES.initialize);
    },
    async list() {
      const names = await fileIo.listFile(root);
      const files: LogFileInfo[] = [];
      for (const name of names) {
        if (!isOwnedFileName(name)) continue;
        const stat = await fileIo.lstat(path(name));
        if (!stat.isFile()) continue;
        const modifiedAt = stat.mtime * 1000;
        if (!Number.isSafeInteger(stat.size) || stat.size < 0 || !Number.isFinite(modifiedAt)) {
          throw createLogFileError(LOG_FILE_FAILURES.initialize);
        }
        files.push({ name, bytes: stat.size, modifiedAt });
      }
      return files;
    },
    async read(name) {
      const location = path(name);
      const stat = await fileIo.lstat(location);
      if (!stat.isFile()) throw createLogFileError(LOG_FILE_FAILURES.initialize);
      const text = await fileIo.readText(location, { encoding: 'utf-8' });
      if (typeof text !== 'string') throw createLogFileError(LOG_FILE_FAILURES.initialize);
      return text;
    },
    async getFile(name) {
      if (typeof name !== 'string' || !isSnapshotFileName(name)) {
        throw createLogFileError(LOG_FILE_FAILURES.invalidSnapshot);
      }
      const location = path(name);
      const stat = await fileIo.lstat(location);
      if (!stat.isFile() || !Number.isSafeInteger(stat.size) || stat.size < 0) {
        throw createLogFileError(LOG_FILE_FAILURES.snapshot);
      }
      return { uri: fileUri.getUriFromPath(location), bytes: stat.size };
    },
    write: (name, text) => writeText(name, text, false),
    append: (name, text) => writeText(name, text, true),
    async remove(name) {
      const location = path(name);
      try {
        await fileIo.unlink(location);
      } catch (error) {
        if (!hasErrorCode(error, 13900002)) throw error;
      }
    },
  };
  nativeRoots.set(root, io);
  return createLogFileStore({ io, createId: options.createId });
}
