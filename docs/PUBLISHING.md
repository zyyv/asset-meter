# Assets Size 发布清单

目标：先生成并验证可安装的 VSIX，再上传 Marketplace。当前扩展版本为 `0.3.0`，`package.json` 中的发布者已准备为 `zyyv`。首次发布前，需要在当前 Microsoft 账号下实际创建并拥有该 Publisher。

## 1. 创建发布者并确定扩展身份

打开 [Visual Studio Marketplace 发布者管理页](https://marketplace.visualstudio.com/manage)，使用你的 Microsoft 账号登录并选择 **Create publisher**。名称和 ID 使用 `zyyv`，是否可用以页面为准。创建操作同时接受 Marketplace 发布者协议，需要账号持有人确认。

创建完成后，把 **Publisher ID** 填入根目录 `package.json` 的 `publisher` 字段。它与显示名称不同；正式扩展 ID 为 `<publisher>.vscode-asset-size`。现有 `name` 和 `assetSize.*` 设置键保留兼容性，用户看到的产品名为 **Assets Size**。正式发布后不要随意更改身份字段。

本地验证：

```sh
pnpm release:check
```

此命令会拒绝 `local-assets` 占位值，但不检查 Publisher 的远程存在性或账号权限；它们必须在 Marketplace 中验证。设置页使用运行时扩展 ID，集成测试从 manifest 读取身份，替换 Publisher 后无需修改源码。

## 2. 检查展示材料并同步仓库

确认以下文件与最终功能一致：

| 文件 | 用途 |
| --- | --- |
| `images/icon.png` | 256 × 256 Marketplace 图标 |
| `images/logo.png` | 高清 Logo 原始素材，不打入 VSIX |
| `README.md` / `README.zh-CN.md` | 英文商店介绍 / 完整中文说明 |
| `images/compression.png` | 0.3.0 开发构建的真实压缩截图（已标注名称变更） |
| `CHANGELOG.md` / `LICENSE` / `THIRD_PARTY_NOTICES.md` | 版本记录及许可证 |

README 已链接 [zyyv/vscode-assets-size](https://github.com/zyyv/vscode-assets-size)。提交并推送这些改动后，再发布到商店：`vsce` 会把相对图片路径转换为仓库的 HTTPS 地址，因此仓库对应分支上的图片必须可访问。默认使用 `main` 分支。

版本号继续使用 `0.3.0`，适合该版本尚未正式发布的情况。如果这个版本已经发布过，需要先更新 `package.json` 的版本并补充 CHANGELOG。VSIX 文件名会自动跟随版本变化。

## 3. 构建、检查并试装

使用 Node.js 24+ 与 `package.json` 指定的 pnpm。首次安装依赖后执行一键准备：

```sh
pnpm install --frozen-lockfile
pnpm release:prepare
```

`release:prepare` 会依次执行发布资料检查、lint、类型检查与构建打包、单元测试。输出 `artifacts/assets-size-<version>.vsix`。未创建 Publisher 时，可先完成本地验证：

```sh
pnpm release:check --allow-local-publisher
pnpm lint
pnpm package
pnpm test:unit
```

包只包含运行时构建、WASM 编解码器及许可、商店 README/图标/截图和根目录许可文件；源码、测试、开发脚本、原始 Logo、source maps 和本机产物不打入包。检查文件列表：

```sh
pnpm exec vsce ls --no-dependencies
```

在独立 VS Code 配置或可丢弃测试副本中，使用 **扩展 → ⋯ → 从 VSIX 安装…** 安装最终包，并完成以下检查：

- 悬停能看到大小；设置页能打开；修改文件后统计刷新。
- 补丁在可丢弃的应用副本中安装、重载后，行内大小和文件数量显示正确；恢复命令能撤销补丁。不要用日常工作的应用副本做补丁测试。
- JPEG、PNG、WebP 都能打开对比；PNG 无损；并排、滑块和缩放可用。
- Save As 不改原图；取消不写文件；源文件变化时覆盖被拒绝；Always Allow 仍等待点击保存。
- 核对 README、图标、命令名、仓库链接与实际产品一致。

集成测试和 UI 脚本：

```sh
VSCODE_EXECUTABLE_PATH="/path/to/disposable/Code" pnpm test:integration
VSCODE_EXECUTABLE_PATH="/path/to/patched/disposable/Code" pnpm test:ui
VSCODE_EXECUTABLE_PATH="/path/to/disposable/Code" pnpm test:compression:ui
```

GitHub Actions 会在 push、pull request 和手动运行时执行 lint、打包与单元测试，并保留 VSIX 14 天。工作流允许本地 Publisher 占位值以便开发，**不会发布**；正式上传前仍需运行不带放宽参数的 `pnpm release:prepare`。

## 4. 上传到 Marketplace

推荐首次发布通过 [发布者管理页](https://marketplace.visualstudio.com/manage)完成：选择 Publisher → **New extension → Visual Studio Code** → 上传刚验证的 VSIX。检查商店预览中的名称、图标、README、许可证、仓库和 Issues 链接，再提交发布。更新现有扩展时使用该扩展的更新入口。

仅修改 `package.json` 后，之前生成的 VSIX 不会自动更新：必须重新运行 `pnpm release:prepare`，上传新包。

CLI 发布是可选项。请按 [VS Code 官方发布文档](https://code.visualstudio.com/api/working-with-extensions/publishing-extension)配置受支持的认证方式。官方目前推荐 Microsoft Entra ID 自动发布，并说明全局 Azure DevOps PAT 将于 **2026-12-01** 退役。首次手动上传 VSIX 不需要把 PAT 保存到项目或聊天中。

## 5. 发布后核对

搜索 **Assets Size**，在干净配置中从 Marketplace 安装，确认版本与最终 VSIX 一致。在 GitHub 为同一版本创建 Release 并附上 VSIX 和更新说明，将实际 Marketplace 链接加入 README。商店 ID 必须使用已经创建的 Publisher ID，当前不预填无法验证的安装链接。

## Native patch recovery

如扩展已卸载，可重新安装后运行 **Assets Size: Restore Native Explorer Patch**，或在源码仓库构建恢复 CLI：

```sh
pnpm build
node scripts/native-patch.mjs status "/absolute/path/to/VSCode/resources/app"
node scripts/native-patch.mjs restore "/absolute/path/to/VSCode/resources/app"
```

macOS 默认路径为 `/Applications/Visual Studio Code.app/Contents/Resources/app`。Windows 和 Linux 使用各自安装目录下的 `resources/app`。命令会验证原始备份与当前程序文件；若因编辑器更新或外部修改而拒绝恢复，请保留 `.asset-size-native-patch` 备份，并通过官方安装包修复 VS Code，不要强行写回旧版程序文件。
