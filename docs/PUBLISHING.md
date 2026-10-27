# Publishing Asset Meter

The extension display name is **Asset Meter**, the package name is `asset-meter`, and the extension ID is `zyyv.asset-meter`. Both registries use the publisher / namespace `zyyv`. The source repository is [zyyv/asset-meter](https://github.com/zyyv/asset-meter).

## Publisher setup

1. Use your `zyyv` publisher in the [Visual Studio Marketplace management page](https://marketplace.visualstudio.com/manage/publishers/zyyv). Store its publishing token in the GitHub Actions repository secret `VSCE_TOKEN`.
2. Sign in to [Open VSX](https://open-vsx.org/) with GitHub, associate your Eclipse account, and sign the Publisher Agreement. Create an access token in [Access Tokens](https://open-vsx.org/user-settings/tokens).
3. Create the Open VSX namespace once, if it does not already exist: `pnpm exec ovsx create-namespace zyyv`. Enter the Open VSX token at the masked prompt. Store the token in the GitHub Actions repository secret `OVSX_TOKEN`.
4. [Claim ownership of the namespace](https://github.com/EclipseFdn/open-vsx.org/wiki/Managing-Namespaces). If the extension also exists on Marketplace, Open VSX may accept the upload but keep it under review until ownership is verified.

## Release

Commit the intended source and documentation changes, then run:

```sh
pnpm release
```

Choose a numeric `major.minor.patch` version. Bumpp updates `package.json`, creates the release commit and matching `v<version>` tag, and pushes them. The Release workflow checks the version, installs dependencies, runs lint, typechecks, builds, packages and runs unit tests. It publishes the same `asset-meter-<version>.vsix` to Marketplace and Open VSX, then attaches it to a GitHub Release.

The current workflow publishes regular releases. A `-beta` suffix alone does not enable the Marketplace pre-release channel; that channel requires a numeric version and the `--pre-release` packaging or publishing flag. Update the workflow before using it for a pre-release.

## Local package

```sh
pnpm package
```

This generates `asset-meter-<version>.vsix`. In VS Code, choose **Extensions → ⋯ → Install from VSIX…** to test it locally. The manifest must contain `publisher: zyyv`, `name: asset-meter`, and `displayName: Asset Meter`.

## Native patch recovery

Before uninstalling Asset Meter, run **Asset Meter: Restore Native Explorer Patch** and reload VS Code.

If the extension is already uninstalled, build this repository and restore using the actual application directory:

```sh
pnpm build
node scripts/native-patch.mjs status /absolute/path/to/VSCode/resources/app
node scripts/native-patch.mjs restore /absolute/path/to/VSCode/resources/app
```

The default backup directory is `.asset-meter-native-patch`. Recovery verifies the backup hashes and current program files before writing. Keep the original backups if recovery reports a mismatch or an editor update.
