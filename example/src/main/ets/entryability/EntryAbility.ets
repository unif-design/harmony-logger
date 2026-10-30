import { AbilityConstant, UIAbility, Want } from '@kit.AbilityKit';
import { window } from '@kit.ArkUI';
import { createLogger } from '@unif/harmony-logger';
import { flushExampleLogging, startExampleLogging, stopExampleLogging } from '../loggerHost';

export default class EntryAbility extends UIAbility {
  private ready: Promise<void> = Promise.resolve();
  private destroyed: boolean = false;

  onCreate(_want: Want, _launchParam: AbilityConstant.LaunchParam): void {
    this.destroyed = false;
    this.ready = startExampleLogging(this.context).catch((): void => {});
  }

  onWindowStageCreate(windowStage: window.WindowStage): void {
    this.ready.then((): void => {
      if (this.destroyed) return;
      windowStage.loadContent('pages/Index').catch((): void => {
        createLogger('example').error('example.content_load_failed');
      });
    });
  }

  onForeground(): void {
    flushExampleLogging().catch((): void => {});
  }

  onBackground(): void {
    flushExampleLogging().catch((): void => {});
  }

  async onDestroy(): Promise<void> {
    this.destroyed = true;
    try {
      await flushExampleLogging();
    } finally {
      stopExampleLogging();
    }
  }
}
