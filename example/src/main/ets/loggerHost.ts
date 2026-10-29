import { bundleManager } from '@kit.AbilityKit';
import type { common } from '@kit.AbilityKit';
import { deviceInfo } from '@kit.BasicServicesKit';
import { util } from '@kit.ArkTS';
import { fileIo } from '@kit.CoreFileKit';
import {
  consoleTransport,
  createLogger,
  installLogging,
  markLoggingUnavailable,
} from '@unif/harmony-logger';
import type { LoggingHandle, LogSnapshot, LogSnapshotFile } from '@unif/harmony-logger';
import { createLogFiles } from '@unif/harmony-logger/Files';

export interface ExampleLogResources {
  busy: boolean;
  ownerKey: string | null;
  snapshot?: LogSnapshot;
  transferredFile?: LogSnapshotFile;
}

let logging: LoggingHandle | undefined;
const resources: ExampleLogResources = { busy: false, ownerKey: null };

export async function startExampleLogging(context: common.UIAbilityContext): Promise<void> {
  if (logging) return;
  try {
    const bundle = bundleManager.getBundleInfoForSelfSync(bundleManager.BundleFlag.GET_BUNDLE_INFO_DEFAULT);
    const createId = (): string => util.generateRandomUUID();
    const handle = installLogging({
      policy: {
        service: 'logger-example',
        allowedFields: ['reason', 'count', 'bytes'],
        startupScopes: ['example'],
      },
      environment: {
        appVersion: bundle.versionName,
        installedAppVersion: bundle.versionName,
        bundleId: bundle.name,
        buildNumber: String(bundle.versionCode),
        platform: 'harmony',
        osVersion: deviceInfo.osFullName,
        deviceModel: deviceInfo.productModel,
        development: context.applicationInfo.debug,
      },
      files: createLogFiles({ context, directoryName: 'LoggerExample', createId }),
      createId,
      console: { target: console, transport: consoleTransport },
      consoleTimeZone: 'Asia/Shanghai',
    });
    logging = handle;
    await handle.setOwner(null);
    if (logging === handle) {
      resources.ownerKey = null;
      createLogger('example').info('example.ready');
    }
  } catch (error) {
    markLoggingUnavailable('example.initialize_failed', error);
    throw error;
  }
}

export function getExampleLogging(): LoggingHandle | undefined {
  return logging;
}

export function getExampleLogResources(): ExampleLogResources {
  return resources;
}

export async function flushExampleLogging(): Promise<void> {
  await logging?.flush();
}

export function stopExampleLogging(): void {
  const handle = logging;
  logging = undefined;
  resources.snapshot = undefined;
  handle?.dispose();
  // 已交付文件仍由消费方持有，读取结束或显式重试时才释放。
}

export async function releaseExampleSnapshotFile(): Promise<void> {
  const file = resources.transferredFile;
  if (!file) return;
  await file.release();
  if (resources.transferredFile === file) resources.transferredFile = undefined;
}

export async function consumeExampleSnapshotFile(file: LogSnapshotFile): Promise<number> {
  resources.transferredFile = file;
  try {
    const opened = await fileIo.open(file.uri, fileIo.OpenMode.READ_ONLY);
    try {
      const buffer = new ArrayBuffer(64 * 1024);
      let total = 0;
      while (true) {
        const bytes = await fileIo.read(opened.fd, buffer);
        if (!Number.isSafeInteger(bytes) || bytes < 0 || bytes > buffer.byteLength) {
          throw new Error('example.invalid_read_size');
        }
        if (bytes === 0) return total;
        total += bytes;
      }
    } finally {
      await fileIo.close(opened);
    }
  } finally {
    await releaseExampleSnapshotFile();
  }
}
