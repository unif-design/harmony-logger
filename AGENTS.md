# Harmony Logger 开发入口

本仓库提供 HarmonyOS 7.0.0／API 26 的原生日志 HAR。使用中文交流。

- 开发、测试、审查和交付分别使用 `unif-harmony-dev`、`unif-harmony-test`、`unif-harmony-review`、`unif-code-delivery`。从[Unif 技能市场](https://github.com/unif-skill/unif-portal-dev-skills#安装与使用)安装 `unif-logger` 插件，按其鸿蒙指引、本仓公开文档及固定的 RN 修订核对 Logger 的公开入口、文件和共享核心。
- RN Logger 是日志格式、脱敏、队列、身份和快照语义的唯一源；采用修订见 `logger-source.json`。`library/src/main/ts/generated/`、`library/Index.ts`、`library/FORMAT.md` 和来源清单由 `scripts/sync-core.cjs` 生成，不手改。
- SDK 文件、摘要、时钟及路径/URI 差异放在 `native/`；不从 Portal 或 Design 引入业务状态，不自动上传日志。
- 示例消费根入口及公开 `Files` 入口；HAR 构建、独立消费、设备文件行为分别验证。
- 保留身份、迟到回调、路径校验、短写、并发和快照所有权保护。`clear()` 保留活跃快照，由调用方释放。
- 库改动走独立分支；提交、推送、合并、发布和安装按本次授权。提交与 PR 说明使用中文。
