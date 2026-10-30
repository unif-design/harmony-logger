# @unif/harmony-logger

HarmonyOS 7.0.0／API 26 的结构化日志库。包含日志规范化与脱敏、操作关联、健康状态、身份隔离、滚动文件和诊断快照；不自动上传日志，不改变业务成功或失败的判断。

当前 `0.1.3` 为尚未发布的鸿蒙开发版本。正式发布并通过中心仓审核后安装：

```sh
ohpm install @unif/harmony-logger
```

发布前在宿主的 `oh-package.json5` 中使用已构建 HAR 的 `file:` 依赖；仓库内 `example` 默认依赖 `file:../library`。两种消费方式都从包的公开入口导入。

## 接入

应用安装一次并持有 `LoggingHandle`。环境字段由宿主从真实应用与设备信息取得；唯一 ID 使用宿主已有生成器。下面的函数可放在宿主 `.ts` 文件中，由 Ability 调用：

```ts
import type { common } from '@kit.AbilityKit';
import { createLogger, installLogging } from '@unif/harmony-logger';
import type { LogEnvironment, LoggingHandle } from '@unif/harmony-logger';
import { createLogFiles } from '@unif/harmony-logger/Files';

export async function startLogging(
  context: common.Context,
  environment: LogEnvironment,
  createId: () => string,
): Promise<LoggingHandle> {
  const logging = installLogging({
    policy: {
      service: 'sample-app',
      allowedFields: ['reason', 'count'],
      startupScopes: ['bootstrap'],
    },
    environment,
    files: createLogFiles({ context, directoryName: 'Logs', createId }),
    createId,
  });
  await logging.setOwner(null);
  createLogger('bootstrap').info('application.ready');
  return logging;
}
```

`LogEnvironment` 必填 `appVersion`、`platform`、`osVersion` 和 `development`；`platform` 使用 `harmony`。可选 `installedAppVersion`、`bundleId`、`buildNumber`、`deviceModel`、`systemName`、`systemVersion`。宿主捕获初始化错误，必要时调用 `markLoggingUnavailable(code, error)` 记录不可用状态。

同一运行时重复 `installLogging` 返回已有句柄，配置仅在首次安装时生效。应用在登录、退出及切换账号时调用 `setOwner(ownerKey)`；匿名为 `null`，登录身份使用应用既定的安全身份摘要。业务组件调用 `createLogger(scope)`，不另建文件存储或身份状态。

## 根入口

| 接口 | 用途与边界 |
| --- | --- |
| `installLogging(options)` | 安装策略、环境与文件存储，返回 `LoggingHandle`；配置错误会抛出 |
| `createLogger(scope)` | 提供 `debug/info/warn/error(event, metadata?)` 和 `captureError`；生产环境跳过 debug |
| `createOperationContext(trigger, parent?)` | 生成操作关联和耗时上下文；拒绝旧身份或旧运行的上下文 |
| `getLogStatus()` | 返回安装、文件状态、丢弃计数与最近失败；用于确认刷盘健康状态 |
| `getFailureDiagnostics(error)` | 提取受控错误类别、原因、错误码和来源，保留有界原因链 |
| `redactDiagnosticText(text)`、`isSensitiveDiagnosticField(key)` | 复用统一脱敏与敏感字段判定 |
| `getLogRetentionPolicy()` | 查询默认文件保留上限 |
| `markLoggingUnavailable(code?, error?)` | 宿主报告初始化不可用状态 |
| `consoleTransport` | 默认后端的控制台 transport，显式启用 console 采集时使用 |

`LogMetadata` 支持 `context`、`phase`、`outcome`、`code`、`httpStatus`、`businessCode`、`serverTraceId`、`fields`、`error`。`fields` 只保留安装白名单和安全值；不要传凭据、请求正文或完整业务对象。`captureError` 返回规范化 JSONL 或 `null`，不证明磁盘写入成功。完整记录规则见 [日志输出格式](FORMAT.md)。

默认不包装全局 console。需要采集时传 `console: { target: console, transport: consoleTransport }`；使用自定义 `backend` 时必须连接该后端的实际 transport。`consoleTimeZone` 仅支持 `UTC`（默认）与 `Asia/Shanghai`，只影响可读展示；JSONL 始终使用 UTC。

`now` 可注入毫秒时间，默认 `Date.now`；`monotonicNow` 默认调用系统 ACTIVE 单调时钟，用于操作耗时。两者都不从日志内容推算时间。

## 文件入口与生命周期

`@unif/harmony-logger/Files` 提供 `createLogFiles({ context, directoryName, createId })`。目录位于 `context.filesDir` 的子目录，不申请外部存储或网络权限。`directoryName` 须以字母或数字开头，只含字母、数字、下划线、点和短横线，最长 64；不能是路径或父目录。只管理自有日志和快照，其他业务文件不参与清理。

需要真实的自定义后端时才使用同入口的 `createLogFileStore({ io, createId, now?, limits? })`。`LogFileIO` 提供 `ensureRoot/list/read/getFile/write/append/remove` 异步操作，文件时间为毫秒；`getFile` 返回真实 `file://` URI 和字节数，允许鸿蒙 bundleName authority。默认文件适配通过系统 API 生成 URI。

| `LoggingHandle` 方法 | 行为 |
| --- | --- |
| `setOwner(ownerKey)`、`flush()` | 请求身份绑定或刷盘；内部失败进入健康状态，不能仅凭 Promise 完成认定成功落盘 |
| `readSummary()` | 当前身份日志的文件数和字节数，失败拒绝 |
| `clear()` | 清理当前身份源日志和待写队列，返回 `success/partial/failed`；活跃快照仍可读 |
| `createSnapshot()`、`readSnapshot(snapshot)` | 创建并读取当前实例、当前身份的快照；保留原始对象，不复制、序列化恢复或跨实例使用 |
| `releaseSnapshot(snapshot)` | 释放未交付快照；失败可重试 |
| `takeSnapshotFile(snapshot)` | 转移文件所有权，返回 `{ uri, bytes, release }`，原快照立即失效 |
| `dispose()` | 释放实例并使未交付快照失效；已交付文件继续归接收方 |

`partial` 包含 `removedFiles`、`remainingFiles`、`message`；`failed` 包含 `code`、`message`。宿主按实际结果反馈，不将部分清理当作完成。

未交付快照在身份切换或 `dispose()` 后失效，`clear()` 不使其失效。读取文本结束后显式释放；交付文件须等接收方异步读取完毕再调用 `file.release()`。释放成功可重复调用，失败保留同一个对象重试；清理、切换账号和实例释放不能提前删除接收方持有的文件。库不负责分享 UI 或上传。

默认限制：单条 8 KiB、单文件 1 MiB、最多 10 个日志文件、保留 7 天、队列 256 KiB、批次 64 KiB、刷盘间隔 1 秒。调用方不自行拼接日志文件名或 JSONL。

## 平台与验证

核心来自固定 RN 修订，平台适配覆盖沙箱文件、同步 SHA-256、单调时钟、`.ets` 位置、鸿蒙私有路径与文件错误码。根入口不加载文件 SDK，文件工厂从 `Files` 入口单独消费。HAR 包含公开声明与字节码，来源清单位于 `src/main/resources/rawfile/logger-provenance.json`。

源码回归、SDK 构建、打包 HAR 消费、设备运行及发布后安装是不同验证层。工程示例和构建结果不能替代设备上的文件行为验收。开发说明与完整示例见 [仓库](https://github.com/unif-design/harmony-logger)。

MIT 许可见 [LICENSE](LICENSE)，继承声明见 [NOTICE](NOTICE)。
