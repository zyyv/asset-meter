# 发布准备状态 · 2026-10-22

当前版本：`0.3.0`。已生成 Publisher 为 `zyyv` 的发布候选包。Marketplace 发布者注册正在进行，尚未上传或发布扩展。

## 已验证

| 项目 | 结果 |
| --- | --- |
| 依赖与静态检查 | `pnpm install --frozen-lockfile`、`pnpm lint`、TypeScript 6.0.3 `pnpm typecheck`、`git diff --check` 通过 |
| 功能单元测试 | 29 / 29 通过，覆盖统计、匹配、缓存、三种压缩格式及补丁备份和恢复 |
| 发布资料检查 | `pnpm release:prepare` 通过，包含正式资料检查、lint、类型检查、构建打包和 29 项单元测试；远程发布者身份仍需在 Marketplace 验证 |
| VSIX 内容 | 35 个文件，780,119 字节；图标、压缩截图、5 个 WASM、worker、编解码器及 picomatch 许可证齐全；无源码、source maps、测试或 node_modules |
| 解压包实际压缩 | 直接运行解压后包内的 worker：JPEG 54,708 → 8,872 字节；PNG 164,088 → 578 字节；WebP 15,226 → 7,000 字节。仅为测试样例结果，不代表通用压缩比例 |

文件：`artifacts/assets-size-0.3.0.vsix`。校验和文件：`artifacts/assets-size-0.3.0.vsix.sha256`。

```text
SHA-256 e9744909d877e323b9ca2d8be1abf4394cc268e709993c2aacc8a22a2ad88f2f
```

该候选包的扩展 ID 为 `zyyv.vscode-asset-size`。仅在当前账号成功创建并拥有 `zyyv` Publisher 后，才可上传发布。

## 发布前待完成

1. 完成 Marketplace 的 `zyyv` Publisher 注册。账号持有人已确认接受发布者协议；创建页面的 reCAPTCHA 连接问题仍待解决。
2. 在独立配置 / 可丢弃的 VS Code 副本中手动试装最终 VSIX。此次 UI 自动化未通过：测试应用在调试连接建立前退出，未执行界面断言。旧临时副本重签名和新复制副本均未解决启动问题，已停止重试；“本机现有副本能用于 UI 自动化”的假设尚未成立。本次也未完成 VS Code 集成测试。
3. 将源码、README、Logo 和截图提交并推送到 GitHub `main`。包内英文 README 的图片链接已转换为仓库的 HTTPS 地址，商店展示需要这些远程文件实际可访问。
4. 按 [PUBLISHING.md](PUBLISHING.md) 上传最终包，检查商店预览并发布。

README 中的压缩截图来自已有的 0.3.0 开发构建，并注明当时名称尚未更新。旧 Explorer 截图与当前行为不一致，未用于发布资料。此次没有改动日常使用的 `/Applications/Visual Studio Code.app`，UI 尝试只操作了临时副本、配置和工作区。

## 后续发布验证

新增的 GitHub Actions 工作流尚未在远程运行。推送后应确认工作流成功；它仅检查和打包，不发布。每次正式发布都应重新运行发布检查和最终安装包试装，不能把本次本地结果视作未来构建的验证结果。
