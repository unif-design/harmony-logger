# harmony-logger

HarmonyOS 7.0.0／API 26 原生日志库，提供结构化记录、脱敏、身份分区、滚动文件及诊断快照。公开入口、接入示例与文件生命周期见 [包文档](library/README.md)，统一格式见 [日志格式](library/FORMAT.md)。

当前开发版本为 `0.1.3`，尚未发布到 OHPM。行为源为 RN Logger 已发布的 `0.1.3`，固定采用其 main 修订 [ca8bda0](https://github.com/unif-design/react-native-logger/commit/ca8bda0d279a1ec07016a0feb6355c890cd7a3cc)；该修订包含 `clear()` 保留活跃快照的文档修正。采用记录见 [logger-source.json](logger-source.json)。

## 工程与来源

- `library/`：真实 HAR，公开根入口与 `Files` 文件入口；运行时不依赖 React、RN、Design、Node 或 npm 包。
- `example/`：通过公开入口接入的 ArkUI 宿主，演示记录、摘要、清理、身份切换、快照和文件交接。
- `library/src/main/ts/generated/`：从固定 RN 修订生成的完整核心依赖闭包；不手工维护另一套日志状态机。
- `library/src/main/ts/native/`：文件、摘要、单调时钟、路径脱敏、文件 URI 和 SDK 错误码适配。

同步方向为 **鸿蒙采用 RN main 的明确修订**。RN 更新后先核对契约和依赖，再更新采用记录、重新生成和验证，不能只改版本号。具体步骤见 [开发与验证](docs/DEVELOPMENT.md)；开发入口见 [AGENTS.md](AGENTS.md)。

## 本地检查

使用 `.nvmrc` 指定的 Node，旁边放置包含采用修订的 `react-native-logger` Git 仓库。共享回归还需要该源仓库已安装其锁定的开发依赖。

```sh
npm ci --ignore-scripts
npm run generate:core
npm run check:core
npm test
npm run test:source-core
```

源仓库不在相邻目录时，生成、校验和共享回归均支持 `--source-root /path/to/react-native-logger`。命令只读固定 Git 对象，不读取源仓未提交代码。

## DevEco 与 HAR 消费

用配套 API 26 SDK 的 DevEco Studio 打开根目录，先构建本地示例，再打包并验证独立 HAR 消费：

```sh
npm run build:example
npm run build:har
python3 scripts/verify-har-consumer.py
```

HAR 位于 `library/build/default/outputs/default/library.har`。验包脚本核对包版本、声明、字节码、许可、文档及来源清单，将现有示例复制到临时目录，移除源码库模块，仅依赖该 HAR 构建。未签名 HAP 只证明构建通过；设备安装、真实 SDK 文件行为和业务验收须另行完成。

## CI 与发布

仓库沿用 [.github 通用规范](https://github.com/unif-design/.github/blob/2a6e991697447f91127664eafb7aea80d5751194/ONBOARDING.md)，CI 配置工作流语法、生成漂移、原生适配和共享核心回归；PR 标题单独检查。完整云端 SDK 构建与 OHPM 自动发布尚未接入，配置存在不表示远端 CI 已运行。

发布须在本次明确授权范围内进行。发版前重新核对采用版本、完成 HAR 验包并执行 `ohpm prepublish library/build/default/outputs/default/library.har`；预检不替代中心仓审核或发布后安装验证。不把签名密钥、发布码或本机配置写入仓库。

MIT 许可见 [LICENSE](LICENSE)，继承实现的声明见 [NOTICE](library/NOTICE)。安全问题按 [SECURITY.md](SECURITY.md) 私密报告。
