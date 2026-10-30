import { systemDateTime } from '@kit.BasicServicesKit';
import { installLogging as installCoreLogging } from '../generated/runtime/installLogging';
import type { LoggingOptions } from '../generated/types';
import type { LogRuntime } from '../generated/runtime/types';

export function installLogging(options: LoggingOptions): LogRuntime {
  return installCoreLogging({
    ...options,
    monotonicNow: options.monotonicNow ?? (() => systemDateTime.getUptime(systemDateTime.TimeType.ACTIVE, false)),
  });
}
