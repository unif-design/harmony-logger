# Harmony Logger 实施计划

> 执行使用 `superpowers:executing-plans`；文件适配子任务按约定接口并行，合并后统一审查。

**目标：** 提供 API 26 原生日志 HAR 和公开消费示例，对齐 RN Logger 的记录、诊断、身份与文件生命周期。

**结构：** 从 `logger-source.json` 固定的 RN main 修订生成完整核心依赖闭包。平台层实现 SDK 文件 IO、同步 SHA-256、单调时钟及路径／URI 差异，不手维第二套脱敏、队列或快照状态机。

**技术：** HarmonyOS 7.0.0／API 26、TypeScript 互操作核心、TypeScript 公开入口和 ArkUI 示例；核心运行时不依赖 React、RN、Design、Node、crypto-js 或 lodash。

**依据：** RN Logger 固定修订的 `docs/FORMAT.md`、`docs/api/root.md`、`docs/api/files.md` 及实际回归；用户已确认 `clear()` 保留使用中的快照，RN 文档已纠正。当前采用 RN 0.1.3 的 main 修订 ca8bda0d279a1ec07016a0feb6355c890cd7a3cc；RN 已发布，鸿蒙包尚未发布。

## 约束

- 其他五库建立仓库治理和空 HAR 工程骨架，Design 功能暂停；不发布、安装设备或接入 SDK 云 runner／OHPM 自动发布。
- 共享核心、`Index.ts` 和 `FORMAT.md` 从源生成并只读校验，平台替换点必须显式且对源变化失败。
- 文件使用调用方 Context 的私有目录，不上传日志；包根不提前加载文件 SDK，文件工厂从 `Files` 入口消费。
- 快照与日志对象身份、同根串行队列、身份周期及交付后的释放责任保持。

## 实施与验证

- [x] `scripts/sync-core.cjs`、`logger-source.json`：固定源依赖图、版本与哈希，严格限制平台替换；`generate:core` 后 `check:core` 无漂移。
- [x] `library/src/main/ts/native/{utf8,sha256,sumBy,diagnosticPatterns,fileUri,installLogging}.ts`：检验 UTF-8 边界、摘要、`.ets` 位置、鸿蒙私有路径脱敏、带 bundleName 的 file URI、UTC／北京时间与注入时钟。
- [x] `native/createLogFiles.ts`、`native/types.ts`：验证目录／文件边界、同根 IO、秒→毫秒、短写、关闭失败、非 owned 文件与错误传播。
- [x] `tests/`：复用 RN 核心行为用例，补齐活跃快照在 clear 后可读、伪造快照、A→B→A 旧周期、交付与释放失败重试、console 包装所属关系。
- [x] `library/Index.ts`、`library/Files.ts`、`example/`：实际 ArkTS 消费根与文件入口，构建 release HAR 和示例，再从打包 HAR 独立消费。
- [x] README、API、包文档与来源记录：说明平台差异、权限、可复现命令、采用基线及尚未取得的设备证据。

## 重点边界

- 迟到 IO、身份切换、dispose 不污染新周期或误删已交付文件。
- 短写与异常关闭不伪装完整落盘；清理 partial／failed 保持可辨。
- 属性访问器、原因链、超大文本、Unicode 与鸿蒙路径不绕过脱敏或容量限制。
- 框架 console、文件 URI、摘要和时钟按实际 API 26 声明实现；Node 替身不代表真实设备行为。
- 源码、自动化、HAR／宿主构建、设备和发布证据分别记录。

## 验证结论

本轮完成生成校验、34 项原生适配／生成器测试和 18 套件 410 项共享核心回归，原始 RN 断言未改。API 26 示例、release HAR 与仅依赖打包 HAR 的隔离示例均构建通过，包内许可、格式文档、声明及来源清单已核对。工作流语法检查通过。

上述结果限于源码、Node 自动化及本机构建；远端 CI 以对应 PR 的实际结果为准。设备运行、真实文件 SDK 故障及业务验收尚未完成，发布须另行取得授权。
