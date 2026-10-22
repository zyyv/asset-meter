<p align="center">
  <img src="images/icon.png" width="96" height="96" alt="Assets Size 标志">
</p>

<h1 align="center">Assets Size</h1>

<p align="center">看清资源体积，让图片轻一点。</p>

<p align="center">
  <a href="https://github.com/zyyv/vscode-assets-size">GitHub 仓库</a> ·
  <a href="https://github.com/zyyv/vscode-assets-size/issues">问题反馈</a> ·
  <a href="https://github.com/zyyv/vscode-assets-size/blob/main/README.md">English</a>
</p>

直接在 VS Code 资源管理器中查看文件大小和文件夹统计，找到占空间的资源。需要优化图片时，在编辑器里压缩 JPEG、PNG 和 WebP，对比效果后再保存。

**VS Code 1.90+ · 桌面扩展 · 本地处理 · MIT 开源**

## 主要功能

- **资源体积一目了然**：在原有 Explorer 文件树中显示完整大小、文件夹总大小和文件数量。
- **颜色提示大文件**：可配置黄色、橙色、红色阈值，只改变体积文字颜色，保留文件名主题和 Git 状态颜色。
- **先对比，再保存**：支持图片并排对比、滑块对比，以及适应窗口和 100% 缩放。
- **按项目定制**：自定义扩展名、文件夹名、排除规则、计量单位和精度；保存、创建、删除、重命名后自动刷新。
- **无需上传**：压缩使用随扩展打包的 WebAssembly 编解码器；运行时不上传文件、不采集遥测、不发起外部网络请求。

```text
▾ assets                         3 files · 7.9 MB
  ▾ images                       2 files · 7.9 MB
      hero.png                              6.3 MB
      texture.jpg                           1.6 MB
    logo.svg                                 39 B
```

> **完整行内标签需要可选的原生 Explorer 补丁。** VS Code 标准装饰 API 的徽标最多支持两个字符。补丁会修改三个桌面程序文件，触发 VS Code 完整性警告，并需要在编辑器更新后重新应用。不安装补丁也可以使用悬停提示和图片压缩。启用前请阅读[原生 Explorer 补丁](#原生-explorer-补丁)。

## 快速开始

1. 如果仓库已提供发布包，从 [GitHub Releases](https://github.com/zyyv/vscode-assets-size/releases) 下载 `.vsix`，在 **扩展 → ⋯ → 从 VSIX 安装…** 中选择它。也可以按[本地开发](#本地开发)的说明自行打包。
2. 打开包含 `assets`、`public`、`static`、`images`、`img`、`media` 或 `fonts` 文件夹的工作区，悬停在匹配的文件或文件夹上查看体积。
3. 需要完整行内标签时，在命令面板执行 **Assets Size: Install / Reapply Native Explorer Patch**，然后点击 **Reload Window**。

运行 **Assets Size: Open Settings** 修改匹配规则。空文件夹显示 `0 files · 0 B`。将 `assetSize.folderNames` 设置为 `["*"]`，即可统计所有文件夹。

## 图片压缩

在 VS Code 内置图片预览中打开 **JPEG、PNG 或 WebP**，点击编辑器右上角的 **Compress Image**。也可以在 Explorer 中右键图片，或运行 **Assets Size: Compress Image**。

![本地压缩图片，保存前对比原图和压缩结果](images/compression.png)

*截图来自 0.3.0 开发构建，拍摄时尚未统一为 Assets Size 名称。*

1. 查看原始体积、压缩后体积和节省比例；切换并排或滑块对比，必要时以 100% 缩放检查细节。
2. 点击 **Save Result…**，选择 **Save As** 或 **Overwrite Original**，再选择 **Allow Once** 或 **Always Allow**。
3. 点击 **Discard** 可关闭结果而不保存。保存成功后，Explorer 体积自动刷新。

**Save As** 默认建议 `name.compressed.ext`，目标文件已存在时会再次确认。**Overwrite Original** 会拒绝覆盖压缩后已变化或有未保存编辑的原文件。**Always Allow** 将保存方式记入用户设置，但每次压缩仍需点击 **Save Result…**。将 `assetSize.compression.saveBehavior` 重设为 `"ask"` 可撤销记住的权限。

| 格式 | 编解码器 | 行为 |
| --- | --- | --- |
| JPEG（`.jpg`、`.jpeg`、`.jpe`） | MozJPEG | 有损压缩，支持质量设置 |
| PNG | Oxipng | 无损优化，不使用质量设置 |
| WebP | libwebp | 有损压缩，支持质量设置 |

压缩保留文件格式和图片尺寸；JPEG 方向会应用到像素。不保证保留元数据。不支持动画 PNG/WebP、超过 50 MiB 的输入或超过 4000 万像素的图片。如果结果没有变小，则保留原始字节。压缩在可取消的后台 worker 中运行，使用本地打包的 [jSquash 编解码器](https://github.com/jamsinclair/jSquash)。

## 配置

打开 **设置 → 扩展 → Assets Size**，或将以下示例放入 `.vscode/settings.json`：

```json
{
  "assetSize.displayMode": "always",
  "assetSize.fileExtensions": [".jpg", ".jpeg", ".png", ".svg", ".webp", ".woff2"],
  "assetSize.folderNames": ["assets", "public", "images", "fonts"],
  "assetSize.exclude": ["**/.git/**", "**/node_modules/**", "**/.DS_Store"],
  "assetSize.showFileCount": true,
  "assetSize.fileCountMode": "recursive",
  "assetSize.units": "decimal",
  "assetSize.compression.quality": 75
}
```

自定义数组会**替换默认数组**。排除规则与 `.gitignore`、`files.exclude` 相互独立。

| 设置 | 默认值 | 说明 |
| --- | --- | --- |
| `assetSize.enabled` | `true` | 启用体积计算和装饰。 |
| `assetSize.displayMode` | `"always"` | 配合补丁显示行内标签；`"hover"` 仅显示悬停提示。 |
| `assetSize.fileExtensions` | 常见资源格式 | 不区分大小写，可省略前导点，支持 `.tar.gz`；`"*"` 匹配所有文件，`[]` 关闭文件装饰。 |
| `assetSize.folderNames` | 常见资源目录 | 按任意层级的文件夹名匹配，不区分大小写；`"*"` 匹配所有文件夹，`[]` 关闭文件夹装饰。 |
| `assetSize.exclude` | 版本控制、依赖、`.DS_Store` | 工作区相对 glob，支持 `**`、`*` 和花括号；被排除的文件不计入总量。 |
| `assetSize.showFileCount` | `true` | 在文件夹大小之前显示文件数量。 |
| `assetSize.fileCountMode` | `"recursive"` | 统计所有后代文件；`"direct"` 只统计直接子文件。大小始终递归计算。 |
| `assetSize.units` | `"decimal"` | 1000 进制 KB / MB / GB；`"binary"` 使用 1024 进制 KiB / MiB / GiB。 |
| `assetSize.decimalPlaces` | `1` | 小数精度，范围为 0–3 位。 |
| `assetSize.colorize` | `true` | 按体积级别为行内大小文字着色。 |
| `assetSize.fileColorThresholdsMiB` | `[0.25, 1, 5]` | 文件的黄色、橙色、红色阈值，自动升序排序。 |
| `assetSize.folderColorThresholdsMiB` | `[10, 50, 100]` | 文件夹的黄色、橙色、红色阈值，自动升序排序。 |
| `assetSize.refreshDelay` | `400` | 文件系统事件批量刷新的延迟，范围为 100–5000 毫秒。 |
| `assetSize.compression.quality` | `75` | JPEG/WebP 质量，范围为 1–100；PNG 始终无损。 |
| `assetSize.compression.saveBehavior` | `"ask"` | `"ask"`、`"saveAs"` 或 `"overwrite"`；仅用户设置可授予记住的保存权限。 |

默认文件扩展名：`.jpg`、`.jpeg`、`.png`、`.gif`、`.webp`、`.avif`、`.svg`、`.ico`、`.bmp`、`.heic`、`.mp4`、`.webm`、`.mov`、`.mp3`、`.wav`、`.ogg`、`.woff`、`.woff2`、`.ttf`、`.otf`、`.pdf`、`.zip`。

默认文件夹名：`assets`、`public`、`static`、`images`、`img`、`media`、`fonts`。匹配某个文件夹不会自动装饰它的所有子文件夹。

默认排除：`**/.git/**`、`**/node_modules/**`、`**/.svn/**`、`**/.hg/**`、`**/.DS_Store`。

### 体积颜色

阈值以 MiB（1,048,576 字节）计算，与显示单位独立。默认规则如下：

| 大小文字 | 文件 | 文件夹 |
| --- | --- | --- |
| 中性 | 小于 256 KiB | 小于 10 MiB |
| 黄色 | 至少 256 KiB | 至少 10 MiB |
| 橙色 | 至少 1 MiB | 至少 50 MiB |
| 红色 | 至少 5 MiB | 至少 100 MiB |

在 `workbench.colorCustomizations` 中修改 `assetSize.sizeWarning`、`assetSize.sizeLarge` 和 `assetSize.sizeCritical`。将 `assetSize.colorize` 设为 `false` 可使用中性大小文字。

## 命令

| 命令面板名称 | 作用 |
| --- | --- |
| **Assets Size: Refresh Sizes** | 重新计算文件大小和文件夹总量。 |
| **Assets Size: Toggle Always / Hover** | 切换行内标签和仅悬停提示模式。 |
| **Assets Size: Open Settings** | 打开本扩展的设置。 |
| **Assets Size: Compress Image** | 压缩所选图片并打开对比。 |
| **Assets Size: Install / Reapply Native Explorer Patch** | 安装、升级或重新应用可选补丁。 |
| **Assets Size: Restore Native Explorer Patch** | 恢复桌面程序原始文件。 |

## 原生 Explorer 补丁

补丁为本扩展的标签扩展徽标长度限制，并在现有 Explorer 文件树中渲染数量和体积。在修改程序前，会将原始文件及 SHA-256 清单备份到 `resources/app/.asset-size-native-patch`。涉及以下三个文件：

```text
out/vs/workbench/api/node/extensionHostProcess.js
out/vs/workbench/workbench.desktop.main.js
out/vs/workbench/workbench.desktop.main.css
```

执行 **Assets Size: Install / Reapply Native Explorer Patch** 后重载窗口，需要拥有桌面应用程序目录的写入权限。补丁不会禁用完整性校验或代码签名检查，VS Code 可能提示安装已损坏。不安装补丁也可以使用悬停提示和图片压缩。

写入前会校验编辑器代码结构；不支持的结构会被拒绝。最低 API 版本不代表补丁兼容每个 VS Code 版本或衍生编辑器。编辑器更新后需要重新应用。0.2.0 / 0.2.1 的旧补丁可直接升级并保留已验证的原始备份。

**卸载扩展前**，执行 **Assets Size: Restore Native Explorer Patch** 并重载。恢复前会验证程序文件和备份，拒绝覆盖已被编辑器更新或其他工具改动的文件。恢复后仍保留原始备份。如果扩展已被卸载，请使用[恢复命令](https://github.com/zyyv/vscode-assets-size/blob/main/docs/PUBLISHING.md#native-patch-recovery)。

## 统计规则与兼容性

文件夹总量包含**所有未被排除的后代文件**，不受显示装饰的扩展名限制。大小是已保存的文件字节数，不是磁盘分配空间。符号链接会被跳过；遇到无法读取的项目，部分总量会标记 `≥`，并在悬停提示中解释。

结果按需计算，最多缓存 10,000 项，最多并发 16 次文件系统操作。保存、新增、删除和重命名后，工作区监听器会刷新文件和祖先目录。外部变更未被捕获时，可执行 **Assets Size: Refresh Sizes**。

| 情况 | 检查方式 |
| --- | --- |
| 只有悬停提示，没有行内大小 | 安装或重新应用补丁并重载，选择 `"always"`，启用 `explorer.decorations.badges`。 |
| 某项没有显示 | 检查匹配规则、排除规则、`assetSize.enabled`，以及是否为符号链接。 |
| Remote SSH、WSL、Dev Containers | 统计在工作区扩展宿主运行；完整行内标签需要访问本地桌面程序文件，不能假定远程会话支持补丁。 |
| 虚拟工作区 | 统计取决于文件系统提供者是否支持文件属性、目录枚举和变更监听。 |
| 浏览器或 vscode.dev | 不支持；扩展需要 Node.js 扩展宿主及 WebAssembly worker。 |

## 隐私与许可

扩展运行时不上传文件、不收集遥测、不发起外部网络请求。远程工作区的处理发生在对应工作区的扩展宿主。图片编解码器随扩展一起分发，图片字节不会被发送到在线服务。

Assets Size 使用 [MIT 许可证](https://github.com/zyyv/vscode-assets-size/blob/main/LICENSE)。随扩展分发的编解码器和依赖请参阅[第三方许可说明](https://github.com/zyyv/vscode-assets-size/blob/main/THIRD_PARTY_NOTICES.md)。

## 本地开发

使用 Node.js 24+ 及 `package.json` 中指定的 pnpm 版本：

```sh
pnpm install --frozen-lockfile
pnpm lint
pnpm test
pnpm package
```

`pnpm package` 会检查类型、构建并生成 `artifacts/assets-size-<version>.vsix`，可从扩展菜单安装。按 **F5** 会在扩展开发宿主中打开示例工作区。

桌面集成和 UI 检查使用独立的 VS Code 测试副本：

```sh
VSCODE_EXECUTABLE_PATH="/path/to/test/Code" pnpm test:integration
VSCODE_EXECUTABLE_PATH="/path/to/patched/test/Code" pnpm test:ui
VSCODE_EXECUTABLE_PATH="/path/to/test/Code" pnpm test:compression:ui
```

不指定可执行路径时，集成测试下载 VS Code 1.90.2。UI 检查使用临时配置和工作区；补丁检查必须使用可丢弃的应用副本。

发布前请按[发布清单](https://github.com/zyyv/vscode-assets-size/blob/main/docs/PUBLISHING.md)操作。CI 自动执行 lint、生成 VSIX 并运行单元测试，不执行发布。欢迎通过 [GitHub Issues](https://github.com/zyyv/vscode-assets-size/issues)提交可复现的问题和改进建议。
