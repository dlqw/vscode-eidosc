# Eidos Language for VS Code

![Eidos owl](images/eidos-owl-512.png)

Official language support for Eidos source files and `eidos.toml` projects.

## Features

- TextMate syntax highlighting for Eidos source and project manifests, including `_0`, `_1`, ... payload placeholders in `then` / `else` selection arms.
- Eidos 0.9 curried binder-list snippets such as `left, right => body`; parenthesized `(left, right) => body` remains a one-tuple-parameter pattern.
- Live compiler diagnostics.
- Completion, hover, go to definition, find references, semantic tokens, and
  inlay hints through the Eidosc language service.
- Stable read-only `eidos-generated://` documents for generated derive declarations, loaded from the compiler-owned `eidos/generatedDocument` LSP request.
- Eidos 0.5 value-level const generics such as `comptime N: Int`, with a
  TextMate fallback for parameter highlighting and compiler-owned semantic domains.
- Document formatting through `eidosc fmt`.
- Project build and run commands.
- Package install, list, and dependency-tree commands.
- A locked active-project context shared by LSP, build, run, and package
  commands. Activating an Eidos source under another `eidos.toml` switches the
  context; browsing Std sources, generated documents, README files, or other
  non-project files does not redirect commands away from the selected project.
- Three Eidos-aware color themes.

The extension follows the current Eidos prerelease language surface. Extension,
compiler, and language versions are tracked independently; see
`compatibility.json` for the validated range.

## Requirements

Install a compatible `eidosc` command or configure a source checkout with the
settings below. The default `auto` mode selects an available backend from the
configured native command, a bundled command when present, or a discoverable
`Eidosc.Cli` .NET project.

## Main settings

| Setting | Purpose |
| --- | --- |
| `eidosc.cliMode` | Select `auto`, `native`, or `dotnet`. |
| `eidosc.cliPath` | Native `eidosc` executable or command name. |
| `eidosc.dotnetPath` | .NET host used by source mode. |
| `eidosc.dotnetProject` | Path to `Eidosc.Cli.csproj` or its project directory. |
| `eidosc.semanticBackend` | Select the long-lived `lsp` backend or snapshot-based `ide` backend. |
| `eidosc.semanticEnabled` | Enable compiler-backed language intelligence. |
| `eidosc.semanticHighlighting` | Enable semantic token highlighting. |
| `eidosc.inlayHints.enabled` | Enable Eidos inlay hints. |
| `eidosc.locale` | Select `zh-CN` or `en` for extension messages. |
| `eidosc.package.targetName` | Optional project target used by build and run commands. |
| `eidosc.run.args` | Arguments passed to the selected Eidos executable target. |

VS Code displays the complete setting descriptions under **Settings >
Extensions > Eidosc**.

## Commands

- `Eidosc: Analyze Current File`
- `Eidosc: Format Document`
- `Eidosc: Build Project`
- `Eidosc: Run Project`
- `Eidosc: Package Install`
- `Eidosc: Package List`
- `Eidosc: Package Tree`

## Development

```powershell
npm test
npx --yes @vscode/vsce package --pre-release
```

The Marketplace accepts numeric `major.minor.patch` extension versions only.
The current numeric package is published on the Marketplace prerelease channel through
the `--pre-release` flag; its validated Eidos language baseline remains
`0.9.0-alpha.1`. A later stable Marketplace release must use a distinct numeric
version such as `0.8.1`; Marketplace versions cannot be reused across channels.

The release workflow defaults to manual Marketplace upload, so it can package
and publish the matching GitHub prerelease without `VSCE_PAT`. Set its
`publish_marketplace` input only when a Marketplace PAT has been configured.

The extension entry point is `out/extension.js`. Contract tests are under
`test/` and validate grammar, manifest, command, semantic, and packaging
surfaces.

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. Report
security issues according to [SECURITY.md](SECURITY.md).

## 中文简介

本插件为 `.eidos` 和 `eidos.toml` 提供语法高亮、编译器诊断、补全、悬停、
定义与引用、语义着色、内联提示、格式化、项目构建运行和包管理命令。请安装
兼容版本的 `eidosc`，或通过 `eidosc.dotnetProject` 指向本地 Eidosc 源码项目。
Eidos 0.5 的 `comptime N: Int` 值级 const generic 由 TextMate 提供词法回退，
精确的 type/value/effect-row 参数域由 Eidosc LSP 语义输出负责。用户 derive 生成的声明
可跳转到稳定的只读 `eidos-generated://` 虚拟文档，内容和 origin 由 Eidosc LSP 提供。
Eidos 0.8 的 `then` / `else` selection payload 占位符 `_0`、`_1` 等具有 TextMate 词法高亮；其精确类型与作用域由 Eidosc LSP 提供。Eidos 0.9 增加 `left, right => body` 柯里化 binder-list snippet；`(left, right) => body` 仍表示单个 tuple 参数。

## License

MIT
