# 开发与验证

## 采用源更新

`logger-source.json` 固定 RN Git 修订和对应包版本。生成读取该修订的 Git 对象，工作区分支和未提交内容不改变输入。当前采用 `ca8bda0d279a1ec07016a0feb6355c890cd7a3cc`，版本 `0.1.3`，含 `clear()` 保留活跃快照的文档修正。

RN 更新时先检查公开契约、完整依赖闭包、测试和实际消费，再更新采用记录及鸿蒙包版本。`scripts/sync-core.cjs` 从根入口与 `createLogFileStore` 遍历完整静态依赖，当前为 45 个 TypeScript 文件；只允许已声明的平台叶子替换。新增外部依赖、替换锚点变化或版本不匹配会失败，不能绕过校验手改生成文件。

生成内容包括核心、`Index.ts`、唯一格式文档 `FORMAT.md` 和来源清单。来源清单保存原始源码、生成目标、平台适配及生成器哈希。`--check` 只读检查漂移；生成前检查文件归属，拒绝覆盖或删除手写文件。

```sh
npm run generate:core -- --source-root ../react-native-logger
npm run check:core -- --source-root ../react-native-logger
npm test
npm run test:source-core -- --source-root ../react-native-logger
```

## 平台适配

| 位置 | 适配依据 |
| --- | --- |
| `native/createLogFiles.ts` | CoreFileKit 的私有目录、实际写入字节数、关闭、lstat、mtime 秒与系统文件 URI；同根共享 IO 以保留核心串行保护 |
| `native/sha256.ts`、`utf8.ts`、`sumBy.ts` | 替换核心的三个 npm 叶子依赖，保持摘要、UTF-8 字节数和求和语义 |
| `native/installLogging.ts` | BasicServicesKit ACTIVE 单调时钟；调用方注入值优先 |
| `native/diagnosticPatterns.ts`、`fileUri.ts`、`fileFailure.ts` | `.ets` 来源、鸿蒙私有路径脱敏、带 bundleName 的 URI 和 SDK 文件错误码 |
| `native/ownProperty.ts` | SDK TypeScript 互操作缺少 `Object.hasOwn` 类型时使用标准自有属性检查，仍不触发访问器 |

两个有类型守卫的返回值按 SDK 类型收窄要求增加静态断言；不改变运行时判断。核心状态机、对象身份、快照归属和清理语义不另写一套。

## 验证范围

`npm test` 覆盖原生文件边界、短写、错误传播、SDK 替换语义、快照所有权、console 所属关系和生成器的无损失败。SDK 使用 Node 替身，不能据此声称真实设备已验证。

`test:source-core` 直接取固定 RN 修订中的原始测试和夹具，对本仓生成核心及原生叶子运行。当前保留 18 个套件、410 条原断言；解析器拒绝意外回读 RN 工作区实现。临时输入、解析收据和测试报告保存在仓库外。

以下五个套件不属于原生共享回归：

| RN 套件 | 原因及本仓对应检查 |
| --- | --- |
| `filesPlatforms` | RN Platform／blob-util 适配；由原生文件测试和 SDK 构建覆盖本端入口 |
| `filesWeb` | 浏览器内存与 unsupported 行为，不是本库平台 |
| `publicEntrypoints` | npm exports；由实际 HAR 独立消费检查本端导出 |
| `consoleCapture`、`sharedBackend` | 使用 Design 或 Web 文件宿主；原生适配测试检查 console 采集、脱敏和恢复所属关系 |

共享测试工具可使用 RN 锁定的 Jest／Babel 开发依赖；运行中的 HAR 没有这些 npm 依赖。

## 构建与实际包消费

```sh
npm run build:example
npm run build:har
python3 scripts/verify-har-consumer.py
```

验包脚本首先比对当前包元数据、全部导出声明、字节码、许可、文档和来源清单；再用复制的真实 `example` 构建，仅保留 example 模块并通过 `file:` 依赖刚生成的 HAR。它不会修改原示例依赖，不访问设备或发布中心仓。格式文档和继承许可通过 `library/build-profile.json5` 的 `packingOptions.asset.include` 显式纳入字节码 HAR，避免被 SDK 默认打包规则遗漏。

安装运行须另外取得本次授权与真实设备证据，至少检查：源日志与快照读取、clear 后快照保留、账号 A→B→A、文件交接后清理／dispose、读取完成释放、后台刷盘和无权限／写满等实际可重现失败。设备无法制造的边界保留自动化证据并明确缺口。

工作流配置仅执行 Node 检查与 actionlint；远端执行结果、云 SDK runner、OHPM 发布和审核状态独立核实。空工程、未签名 HAP 或本机预检均不表示已发布可用。
