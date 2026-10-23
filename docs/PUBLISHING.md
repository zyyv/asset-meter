# Assets Size 发布指南

完成下面的首次配置并提交代码后，每次发布只需一个命令：

```sh
pnpm run publish
```

在 bumpp 中选择 `patch`、`minor`、`major` 或明确的 `x.y.z` 版本并确认，即可自动更新版本、提交并推送 `v<version>` tag。GitHub Actions 执行发布资料检查、lint、类型检查、构建打包和单元测试，通过后发布到 Visual Studio Marketplace，并创建附带 VSIX 的 GitHub Release。

命令要求 Git 工作区干净，请先提交功能改动。若 CHANGELOG 有 `## Unreleased`，会将该节转为新版本；否则从最近一个可达的 `v*` tag 之后的 Git 提交生成记录，首次无 tag 时使用已有提交。已写好的目标版本记录会直接保留。Marketplace 不接受带 `-beta` 等后缀的版本。

使用 `pnpm run publish` 调用项目脚本；`pnpm publish` 是 pnpm 内置的 npm 发布命令。

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

后续版本由 bumpp 更新，无需手改 `package.json`。可以提前将更新说明写入 CHANGELOG 的 `## Unreleased` 节。VSIX 文件名会自动跟随版本变化。

## 3. 构建、检查并试装

使用 Node.js 24.11+ 与 `package.json` 指定的 pnpm。发布工作流会自动验证；如需提前在本地试装，可以执行：

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

日常 `ci.yml` 在 push、pull request 和手动运行时执行检查并保留 VSIX 14 天。`release.yml` 仅由推送 `v*` tag 触发，要求 tag 与 manifest 版本一致，使用严格的发布资料检查，并在验证通过后发布同一份 VSIX。

## 4. 首次配置 GitHub Actions 认证

按 [VS Code 官方 PAT 配置说明](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#get-a-personal-access-token)创建具有 **Marketplace → Manage** 权限的 Azure DevOps PAT。使用的账号必须有 `zyyv` Publisher 的发布权限。

在仓库 **Settings → Secrets and variables → Actions → New repository secret** 添加 `VSCE_PAT`，值填入该 PAT。不要将 token 写入源码或提交到 Git。GitHub Release 使用工作流自动提供的 `GITHUB_TOKEN`，无需额外配置 GitHub token。

提交发布配置和功能改动后，在 `main` 分支运行 `pnpm run publish`，选择版本并确认即可。在仓库 **Actions → Release** 查看进度。如果 Marketplace 已发布而 GitHub Release 步骤失败，可重新运行失败的工作流；`--skip-duplicate` 会跳过已存在的商店版本，并补传 GitHub Release 附件。

当前工作流使用 PAT。官方说明全局 Azure DevOps PAT 将于 **2026-12-01** 退役；届时需按[官方自动发布说明](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#secure-automated-publishing-to-visual-studio-marketplace)迁移到 Microsoft Entra ID，并调整发布步骤的认证方式。

## 5. 发布后核对

搜索 **Assets Size**，在干净配置中从 Marketplace 安装，确认版本与 GitHub Release 附带的 VSIX 一致。将实际 Marketplace 链接加入 README。商店 ID 必须使用已经创建的 Publisher ID，当前不预填无法验证的安装链接。

## Native patch recovery

如扩展已卸载，可重新安装后运行 **Assets Size: Restore Native Explorer Patch**，或在源码仓库构建恢复 CLI：

```sh
pnpm build
node scripts/native-patch.mjs status "/absolute/path/to/VSCode/resources/app"
node scripts/native-patch.mjs restore "/absolute/path/to/VSCode/resources/app"
```

macOS 默认路径为 `/Applications/Visual Studio Code.app/Contents/Resources/app`。Windows 和 Linux 使用各自安装目录下的 `resources/app`。命令会验证原始备份与当前程序文件；若因编辑器更新或外部修改而拒绝恢复，请保留 `.asset-size-native-patch` 备份，并通过官方安装包修复 VS Code，不要强行写回旧版程序文件。
