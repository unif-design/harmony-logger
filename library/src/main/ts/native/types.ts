import type { common } from '@kit.AbilityKit';

export interface NativeLogFilesOptions {
  context: common.Context;
  directoryName: string;
  createId(): string;
}
