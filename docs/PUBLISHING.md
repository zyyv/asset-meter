# Assets Size 发布指南

每次发布只需提交改动后运行：

```sh
pnpm release
```

bumpp 只负责更新 `package.json` 版本、创建提交和 `v<version>` tag，并推送到 GitHub。选择 `patch`、`minor`、`major` 或明确的 `x.y.z` 版本；工作区需保持干净。

推送 tag 后，GitHub Actions 自动校验 tag 与版本一致，执行 lint、类型检查、构建打包和单元测试，再将同一份 VSIX 发布到 Visual Studio Marketplace、Open VSX 和 GitHub Release。Marketplace 发布使用 `x.y.z` 版本；带 `-beta` 等后缀的版本会被 CI 拒绝。

GitHub Release 使用 GitHub 自动生成的更新说明。`CHANGELOG.md` 按需手动维护，bumpp 不再修改它。

## 首次配置

1. 在 [Visual Studio Marketplace](https://marketplace.visualstudio.com/manage) 创建发布者，确认根目录 `package.json` 的 `publisher` 是你的 Publisher ID。当前使用 `zyyv`，扩展 ID 为 `zyyv.vscode-asset-size`；正式发布后保持身份字段稳定。
2. 按 [VS Code 发布说明](https://code.visualstudio.com/api/working-with-extensions/publishing-extension#get-a-personal-access-token)创建具备 Marketplace 发布权限的 PAT，账号需有对应 Publisher 的发布权限。
3. 按 [Open VSX 发布说明](https://github.com/eclipse-openvsx/openvsx/wiki/Publishing-Extensions)配置账号、接受发布者协议，创建与 `publisher` 一致的 namespace，并生成有发布权限的 token。
4. 在仓库 **Settings → Secrets and variables → Actions** 添加 `VSCE_TOKEN` 和 `OVSX_TOKEN`。工作流分别映射为 CLI 使用的 `VSCE_PAT`、`OVSX_PAT`；GitHub Release 使用自动提供的 GitHub token。

发布前确认 README、图标、截图、许可证和仓库链接与功能一致，并已提交到 `main`。打包时 `vsce` 会将 README 相对图片路径转换为仓库链接。

## 本地开发与打包

使用 Node.js 24+ 及 `package.json` 中指定的 pnpm：

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm test
pnpm package
```

`pnpm test` 会先构建，再运行测试。`pnpm package` 调用官方 `vsce` CLI，通过 `vscode:prepublish` 自动检查类型并构建，在仓库根目录生成 `vscode-asset-size-<version>.vsix`。两者都可独立执行；CI 在打包后直接运行 `pnpm exec vitest run`，复用构建产物。

常用辅助命令：`pnpm watch` 监听构建，`pnpm lint --fix` 自动修复 lint，构建后用 `pnpm exec vitest` 监听测试。

包只包含 `.vscodeignore` 允许的运行时构建、WASM 编解码器及许可、README、图标、截图和根目录许可文件。检查文件列表：

```sh
pnpm exec vsce ls --no-dependencies
```

需要桌面集成或 UI 验证时，使用独立的 VS Code 测试副本：

```sh
VSCODE_EXECUTABLE_PATH="/path/to/disposable/Code" pnpm test:integration
VSCODE_EXECUTABLE_PATH="/path/to/patched/disposable/Code" pnpm test:ui
VSCODE_EXECUTABLE_PATH="/path/to/disposable/Code" pnpm test:compression:ui
```

在独立配置中通过 **扩展 → ⋯ → 从 VSIX 安装…** 试装。原生补丁测试应使用可丢弃的应用副本。

## CI 与发布

- `ci.yml`：分支 push、pull request 或手动运行时检查、打包和测试，保留 VSIX artifact 14 天；tag push 交给发布工作流。
- `release.yml`：推送 `v*` tag 时检查、打包和测试，直接调用 `vsce`、`ovsx` 发布，再创建 GitHub Release 并上传 VSIX。

在仓库 **Actions → Release** 查看发布进度。如果只有一个商店发布成功，或 GitHub Release 步骤失败，可重新运行失败的工作流。两个发布 CLI 的 `--skip-duplicate` 会跳过已发布的版本，GitHub Release 附件使用 `--clobber` 支持重传。

发布后确认两个商店与 GitHub Release 附件版本一致。

## Native patch recovery

如扩展已卸载，可重新安装后运行 **Assets Size: Restore Native Explorer Patch**，或在源码仓库构建恢复 CLI：

```sh
pnpm build
node scripts/native-patch.mjs status "/absolute/path/to/VSCode/resources/app"
node scripts/native-patch.mjs restore "/absolute/path/to/VSCode/resources/app"
```

macOS 默认路径为 `/Applications/Visual Studio Code.app/Contents/Resources/app`。Windows 和 Linux 使用各自安装目录下的 `resources/app`。命令会验证原始备份与当前程序文件；若因编辑器更新或外部修改而拒绝恢复，请保留 `.asset-size-native-patch` 备份，并通过官方安装包修复 VS Code，不要强行写回旧版程序文件。
