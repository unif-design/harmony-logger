import {
  createLogger,
  createOperationContext,
  getLogStatus,
} from '@unif/harmony-logger';
import type { AppLogger, LoggingHandle, LogSnapshot } from '@unif/harmony-logger';
import {
  consumeExampleSnapshotFile,
  getExampleLogging,
  getExampleLogResources,
  releaseExampleSnapshotFile,
} from '../loggerHost';
import type { ExampleLogResources } from '../loggerHost';

interface LoggerExampleResult {
  message: string;
  preview?: string;
  summary?: string;
}

interface LoggerExampleFileFailure {
  code: string;
}

@Entry
@ComponentV2
struct LoggerExample {
  @Local statusText: string = '等待日志宿主初始化';
  @Local resultText: string = '先记录示例，再创建快照。';
  @Local summaryText: string = '尚未读取文件摘要';
  @Local previewText: string = '';
  @Local ownerText: string = '匿名';
  @Local busy: boolean = false;
  @Local installed: boolean = false;
  @Local fileReady: boolean = false;
  @Local hasSnapshot: boolean = false;
  @Local hasTransferredFile: boolean = false;
  private resources: ExampleLogResources = getExampleLogResources();
  private logger: AppLogger = createLogger('example');
  private visible: boolean = false;
  private viewVersion: number = 0;

  aboutToAppear(): void {
    this.showPage();
  }

  onPageShow(): void {
    this.showPage();
  }

  onPageHide(): void {
    this.hidePage();
  }

  aboutToDisappear(): void {
    this.hidePage();
  }

  private showPage(): void {
    this.visible = true;
    this.viewVersion += 1;
    this.refreshState();
  }

  private hidePage(): void {
    this.visible = false;
    this.viewVersion += 1;
  }

  private refreshState(): void {
    if (!this.visible) return;
    const status = getLogStatus();
    this.installed = status.installed;
    this.fileReady = status.installed && status.state === 'ready';
    this.busy = this.resources.busy;
    this.hasSnapshot = this.resources.snapshot !== undefined;
    this.hasTransferredFile = this.resources.transferredFile !== undefined;
    this.ownerText = this.resources.ownerKey === null ? '匿名' : '演示身份';
    this.statusText = `状态：${status.state} · 可写：${status.writable ? '是' : '否'}\n` +
      `队列：${status.bufferedBytes} 字节 · 丢弃：${status.droppedCount}\n` +
      `失败码：${status.lastFailureCode ?? '无'}`;
  }

  private requireLogging(): LoggingHandle {
    const handle = getExampleLogging();
    if (!handle) throw new Error('example.not_ready');
    return handle;
  }

  private requireSnapshot(): LogSnapshot {
    const snapshot = this.resources.snapshot;
    if (!snapshot) throw new Error('example.snapshot_required');
    return snapshot;
  }

  private preview(text: string): string {
    return text.length > 4000 ? `${text.slice(0, 4000)}\n（仅显示前 4000 字符）` : text;
  }

  private async runAction(action: () => Promise<LoggerExampleResult>): Promise<void> {
    if (!this.visible || this.resources.busy) return;
    const version = this.viewVersion;
    const handle = getExampleLogging();
    this.resources.busy = true;
    this.refreshState();
    try {
      const result = await action();
      if (!this.visible || version !== this.viewVersion || getExampleLogging() !== handle) return;
      this.resultText = result.message;
      if (result.preview !== undefined) this.previewText = result.preview;
      if (result.summary !== undefined) this.summaryText = result.summary;
    } catch {
      if (this.visible && version === this.viewVersion && getExampleLogging() === handle) {
        this.resultText = this.resources.transferredFile
          ? '交付文件尚未释放；句柄已保留，请重试释放。'
          : '操作未完成；请刷新健康状态后重试。';
      }
    } finally {
      this.resources.busy = false;
      this.refreshState();
    }
  }

  private async recordExamples(): Promise<LoggerExampleResult> {
    this.requireLogging();
    const context = createOperationContext('user');
    this.logger.info('example.info', { context, fields: { count: 1 } });
    this.logger.warn('example.warning', { context, fields: { reason: 'sample_warning' } });
    this.logger.error('example.error', { context, error: new Error('sample_failure') });
    const diagnostic = this.logger.captureError('example.copy_diagnostic', {
      context,
      error: new Error('sample_diagnostic'),
    });
    console.warn('example.console_warning');
    return {
      message: '已调用 Info、Warn、Error、captureError 和显式 console 采集；落盘结果请看摘要。',
      preview: this.preview(diagnostic ?? ''),
    };
  }

  private async flushAndSummarize(): Promise<LoggerExampleResult> {
    const handle = this.requireLogging();
    await handle.flush();
    const summary = await handle.readSummary();
    return {
      message: '已请求 Flush 并读取文件摘要；请结合可写状态判断写入结果。',
      summary: `当前身份：${summary.fileCount} 个文件，${summary.bytes} 字节`,
    };
  }

  private async createSnapshot(): Promise<LoggerExampleResult> {
    const handle = this.requireLogging();
    if (this.resources.snapshot || this.resources.transferredFile) throw new Error('example.resource_pending');
    const snapshot = await handle.createSnapshot();
    if (getExampleLogging() !== handle) throw new Error('example.host_changed');
    this.resources.snapshot = snapshot;
    return { message: `已创建快照：${snapshot.bytes} 字节。` };
  }

  private async readSnapshot(): Promise<LoggerExampleResult> {
    const text = await this.requireLogging().readSnapshot(this.requireSnapshot());
    return { message: '已通过原快照句柄读取规范化 JSONL。', preview: this.preview(text) };
  }

  private async clearAndReadSnapshot(): Promise<LoggerExampleResult> {
    const handle = this.requireLogging();
    const snapshot = this.requireSnapshot();
    const result = await handle.clear();
    const text = await handle.readSnapshot(snapshot);
    const summary = await handle.readSummary();
    const message = result.status === 'success'
      ? '源日志与当前分区队列已清理，原活跃快照仍可读取。'
      : '源日志未全部清理，原活跃快照仍可读取；请检查健康状态。';
    return {
      message,
      preview: this.preview(text),
      summary: `清理结果：${result.status} · 剩余 ${summary.fileCount} 个文件，${summary.bytes} 字节`,
    };
  }

  private async releaseSnapshot(): Promise<LoggerExampleResult> {
    const handle = this.requireLogging();
    const snapshot = this.requireSnapshot();
    await handle.releaseSnapshot(snapshot);
    if (this.resources.snapshot === snapshot) this.resources.snapshot = undefined;
    return { message: '快照已释放；原句柄不再可用。', preview: '' };
  }

  private async transferAndRead(): Promise<LoggerExampleResult> {
    if (this.resources.transferredFile) throw new Error('example.file_release_pending');
    const handle = this.requireLogging();
    const snapshot = this.requireSnapshot();
    const file = await handle.takeSnapshotFile(snapshot);
    if (this.resources.snapshot === snapshot) this.resources.snapshot = undefined;
    const bytes = await consumeExampleSnapshotFile(file);
    return { message: `消费方已用系统文件 API 读取 ${bytes} 字节，并在 finally 中释放交付文件。`, preview: '' };
  }

  private async retryFileRelease(): Promise<LoggerExampleResult> {
    await releaseExampleSnapshotFile();
    return { message: '交付文件已释放，重试句柄已清除。' };
  }

  private async switchOwner(): Promise<LoggerExampleResult> {
    const handle = this.requireLogging();
    const snapshot = this.requireSnapshot();
    const oldContext = createOperationContext('user');
    const nextOwner = this.resources.ownerKey === null ? 'logger-example-owner' : null;
    this.previewText = '';
    this.summaryText = '身份已变化，请重新读取摘要';
    await handle.setOwner(nextOwner);
    if (getExampleLogging() !== handle) throw new Error('example.host_changed');
    this.resources.ownerKey = nextOwner;
    this.resources.snapshot = undefined;
    const staleDiagnostic = this.logger.captureError('example.stale_context', { context: oldContext });
    let snapshotRejected = false;
    try {
      await handle.readSnapshot(snapshot);
    } catch (error) {
      const failure = error as LoggerExampleFileFailure;
      snapshotRejected = failure.code === 'logger.files.snapshot_invalid' ||
        failure.code === 'logger.files.identity_changed';
    }
    if (!snapshotRejected || staleDiagnostic !== null) throw new Error('example.identity_guard_failed');
    return { message: '身份已切换，旧操作上下文与旧快照均被拒绝。', preview: '' };
  }

  build() {
    Scroll() {
      Column({ space: 12 }) {
        Text('Unif Logger 示例')
          .fontSize(26)
          .fontWeight(FontWeight.Bold)
        Text(`当前身份：${this.ownerText}`)
          .fontSize(16)
        Text(this.statusText)
          .fontSize(14)
          .width('100%')
        Text(this.summaryText)
          .fontSize(14)
          .width('100%')
        Text(this.resultText)
          .fontSize(16)
          .width('100%')
        Button('刷新健康状态')
          .onClick((): void => this.refreshState())
        Button('记录 Info / Warn / Error')
          .enabled(this.installed && !this.busy)
          .onClick((): void => { this.runAction((): Promise<LoggerExampleResult> => this.recordExamples()); })
        Button('Flush 并读取文件摘要')
          .enabled(this.installed && !this.busy)
          .onClick((): void => { this.runAction((): Promise<LoggerExampleResult> => this.flushAndSummarize()); })
        Button('创建快照')
          .enabled(this.fileReady && !this.busy && !this.hasSnapshot && !this.hasTransferredFile)
          .onClick((): void => { this.runAction((): Promise<LoggerExampleResult> => this.createSnapshot()); })
        Button('读取活跃快照')
          .enabled(this.hasSnapshot && !this.busy)
          .onClick((): void => { this.runAction((): Promise<LoggerExampleResult> => this.readSnapshot()); })
        Button('清理源日志并验证快照保留')
          .enabled(this.hasSnapshot && !this.busy)
          .onClick((): void => { this.runAction((): Promise<LoggerExampleResult> => this.clearAndReadSnapshot()); })
        Button('交付文件并由消费方读取')
          .enabled(this.hasSnapshot && !this.hasTransferredFile && !this.busy)
          .onClick((): void => { this.runAction((): Promise<LoggerExampleResult> => this.transferAndRead()); })
        Button('释放快照')
          .enabled(this.hasSnapshot && !this.busy)
          .onClick((): void => { this.runAction((): Promise<LoggerExampleResult> => this.releaseSnapshot()); })
        Button('切换身份并验证保护')
          .enabled(this.hasSnapshot && !this.busy)
          .onClick((): void => { this.runAction((): Promise<LoggerExampleResult> => this.switchOwner()); })
        if (this.hasTransferredFile) {
          Button('重试释放交付文件')
            .enabled(!this.busy)
            .onClick((): void => { this.runAction((): Promise<LoggerExampleResult> => this.retryFileRelease()); })
        }
        if (this.previewText.length > 0) {
          Text('安全诊断预览')
            .fontSize(18)
            .fontWeight(FontWeight.Medium)
          Text(this.previewText)
            .fontSize(12)
            .width('100%')
        }
      }
      .alignItems(HorizontalAlign.Start)
      .width('100%')
      .padding(20)
    }
    .width('100%')
    .height('100%')
  }
}
