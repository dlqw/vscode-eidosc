"use strict";

const vscode = require("vscode");
const cp = require("child_process");
const path = require("path");
const fs = require("fs");
let extensionRoot = null;
const COMMAND_PROBE_TTL_MS = 30000;
const LSP_FAILURE_COOLDOWN_MS = 10000;
const commandProbeCache = new Map();
const dotnetProjectCache = new Map();

function isAbsolutePath(target) {
  return path.isAbsolute(target) || /^[A-Za-z]:[\\/]/.test(target);
}

function pathExists(target) {
  try {
    return fs.existsSync(target);
  } catch {
    return false;
  }
}

const manifestLanguageVersions = ["0.7.0-alpha.1"];
const manifestTargetKindValues = ["executable", "exe", "library", "lib"];
const manifestTopLevelKeys = new Set(["manifestSchema", "sourceRoots", "importRoots", "defaultTarget", "nativeLinkMode", "noImplicitStdlib"]);
const manifestSectionKeys = new Map([
  ["package", new Set(["name", "version", "description", "authors", "license", "keywords"])],
  ["language", new Set(["version"])],
  ["dependencies", null],
  ["ffi", new Set(["libraries", "libraryPaths", "includePaths", "nativeSources", "linkerFlags"])],
  ["ffi.platform", null],
  ["targets", new Set(["name", "entry", "kind", "dependencies", "projectDependencies"])]
]);
const manifestSnippetDetails = {
  tablePackage: {
    zh: "package 元数据表",
    en: "Package metadata table"
  },
  tableLanguage: {
    zh: "language 语法配置表",
    en: "Language syntax configuration table"
  },
  tableDependencies: {
    zh: "依赖声明表",
    en: "Dependency declaration table"
  },
  tableFfi: {
    zh: "原生 FFI 配置表",
    en: "Native FFI configuration table"
  },
  tableTargets: {
    zh: "构建目标数组表",
    en: "Build target array table"
  }
};
const manifestFieldDocs = {
  manifestSchema: {
    kind: vscode.CompletionItemKind.Property,
    zh: "Manifest schema 版本。当前纳入版本控制的 manifest 应显式声明 schema 3。",
    en: "Manifest schema version. Current checked-in manifests declare schema 3 explicitly."
  },
  sourceRoots: {
    kind: vscode.CompletionItemKind.Property,
    zh: "当前 package 拥有的源码目录。默认值是 [\"src\"]。",
    en: "Source directories owned by the current package. Defaults to [\"src\"]."
  },
  importRoots: {
    kind: vscode.CompletionItemKind.Property,
    zh: "额外模块搜索目录，不属于当前 package 的 sourceRoots。",
    en: "Extra module search roots that are not owned source roots."
  },
  defaultTarget: {
    kind: vscode.CompletionItemKind.Property,
    zh: "当命令传入项目目录或 eidos.toml 且未显式指定目标名时，默认选择的 target。",
    en: "Default target selected when commands receive the project directory or eidos.toml without an explicit target name."
  },
  nativeLinkMode: {
    kind: vscode.CompletionItemKind.Property,
    zh: "原生链接模式配置。",
    en: "Native linking mode configuration."
  },
  noImplicitStdlib: {
    kind: vscode.CompletionItemKind.Property,
    zh: "设为 true 时，不自动注入内置 Std 包。",
    en: "When true, disables the implicit built-in Std package."
  },
  "package.name": {
    kind: vscode.CompletionItemKind.Property,
    zh: "包名。",
    en: "Package name."
  },
  "package.version": {
    kind: vscode.CompletionItemKind.Property,
    zh: "包版本，建议使用语义化版本号。",
    en: "Package version, typically a semantic version."
  },
  "package.description": {
    kind: vscode.CompletionItemKind.Property,
    zh: "包描述。",
    en: "Package description."
  },
  "package.authors": {
    kind: vscode.CompletionItemKind.Property,
    zh: "作者列表。",
    en: "Package authors."
  },
  "package.license": {
    kind: vscode.CompletionItemKind.Property,
    zh: "许可证标识。",
    en: "Package license identifier."
  },
  "package.keywords": {
    kind: vscode.CompletionItemKind.Property,
    zh: "关键字列表。",
    en: "Package keywords."
  },
  "language.version": {
    kind: vscode.CompletionItemKind.Property,
    zh: "Eidos 语言 SemVer。当前值为 `0.7.0-alpha.1`。",
    en: "Eidos language SemVer. The current value is `0.7.0-alpha.1`."
  },
  "targets.name": {
    kind: vscode.CompletionItemKind.Property,
    zh: "target 名称。",
    en: "Target name."
  },
  "targets.entry": {
    kind: vscode.CompletionItemKind.Property,
    zh: "入口 .eidos 文件路径。",
    en: "Entry .eidos file path."
  },
  "targets.kind": {
    kind: vscode.CompletionItemKind.Property,
    zh: "target 类型，可选 executable/exe/library/lib。",
    en: "Target kind: executable/exe/library/lib."
  },
  "targets.dependencies": {
    kind: vscode.CompletionItemKind.Property,
    zh: "同项目内其他 target 依赖。",
    en: "Dependencies on other targets in the same project."
  },
  "targets.projectDependencies": {
    kind: vscode.CompletionItemKind.Property,
    zh: "引用 [dependencies] 中 path-backed alias 的项目依赖。",
    en: "Project dependencies that point at path-backed aliases from [dependencies]."
  },
  "ffi.libraries": {
    kind: vscode.CompletionItemKind.Property,
    zh: "需要链接的原生库名列表。",
    en: "Native libraries to link."
  },
  "ffi.libraryPaths": {
    kind: vscode.CompletionItemKind.Property,
    zh: "原生库搜索路径列表。",
    en: "Native library search paths."
  },
  "ffi.includePaths": {
    kind: vscode.CompletionItemKind.Property,
    zh: "C 头文件搜索路径列表。",
    en: "C header include search paths."
  },
  "ffi.nativeSources": {
    kind: vscode.CompletionItemKind.Property,
    zh: "需要一并编译的原生源码列表。",
    en: "Native source files compiled with the package."
  },
  "ffi.linkerFlags": {
    kind: vscode.CompletionItemKind.Property,
    zh: "附加 linker flags。",
    en: "Additional linker flags."
  },
  "ffi.platform": {
    kind: vscode.CompletionItemKind.Module,
    zh: "按平台声明额外原生库，例如 windows/linux/macos/unix。",
    en: "Platform-specific native libraries, for example windows/linux/macos/unix."
  }
};

function isManifestDocument(document) {
  if (!document) {
    return false;
  }

  return document.languageId === "eidos-manifest" || path.basename(document.fileName || "") === "eidos.toml";
}

function isEidosSourceDocument(document) {
  if (!document) {
    return false;
  }

  return document.languageId === "eidos" || document.fileName.endsWith(".eidos");
}

function isProjectAwareDocument(document) {
  return isEidosSourceDocument(document) || isManifestDocument(document);
}

function localizeManifestText(locale, item) {
  if (!item) {
    return "";
  }

  return locale === "zh-CN" ? (item.zh || item.en || "") : (item.en || item.zh || "");
}

function getManifestSectionName(document, lineNumber) {
  let currentSection = null;
  for (let index = 0; index <= lineNumber && index < document.lineCount; index += 1) {
    const text = document.lineAt(index).text.replace(/#.*$/, "").trim();
    if (!text) {
      continue;
    }

    const targetArrayMatch = /^\[\[\s*([A-Za-z0-9_.-]+)\s*\]\]$/.exec(text);
    if (targetArrayMatch) {
      currentSection = targetArrayMatch[1];
      continue;
    }

    const sectionMatch = /^\[\s*([A-Za-z0-9_.-]+)\s*\]$/.exec(text);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
    }
  }

  return currentSection;
}

function parseManifestAssignment(lineText) {
  const withoutComment = lineText.replace(/#.*$/, "");
  const match = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/.exec(withoutComment);
  if (!match) {
    return null;
  }

  return {
    key: match[1],
    valueText: match[2] || ""
  };
}

function getManifestHoverKey(document, position) {
  const range = document.getWordRangeAtPosition(position, /[A-Za-z0-9_.-]+/);
  if (!range) {
    return null;
  }

  const token = document.getText(range);
  const section = getManifestSectionName(document, position.line);
  const lineText = document.lineAt(position.line).text;
  const assignment = parseManifestAssignment(lineText);
  if (assignment && range.start.character <= lineText.indexOf("=")) {
    return section ? `${section}.${token}` : token;
  }

  if (/^\[\[?\s*[A-Za-z0-9_.-]+\s*\]?\]?$/.test(lineText.trim())) {
    return token === "platform" && section === "ffi.platform" ? "ffi.platform" : token;
  }

  if (assignment && assignment.key === "version" && manifestLanguageVersions.includes(token)) {
    return "language.version";
  }

  if (assignment && assignment.key === "kind" && manifestTargetKindValues.includes(token)) {
    return "targets.kind";
  }

  return section ? `${section}.${token}` : token;
}

function createManifestMarkdown(key, locale) {
  const normalizedKey = key === "package" || key === "language" || key === "dependencies" || key === "ffi" || key === "targets"
    ? key
    : key;
  const doc = manifestFieldDocs[normalizedKey]
    || manifestFieldDocs[key]
    || (key === "package" ? { zh: "package 元数据表。", en: "Package metadata table." } : null)
    || (key === "language" ? { zh: "language 语法配置表。", en: "Language syntax configuration table." } : null)
    || (key === "dependencies" ? { zh: "依赖声明表。键名就是导入时使用的 package alias。", en: "Dependency declaration table. Keys are package aliases used in imports." } : null)
    || (key === "ffi" ? { zh: "原生 FFI 配置表。", en: "Native FFI configuration table." } : null)
    || (key === "targets" ? { zh: "构建 target 数组表。", en: "Build target array table." } : null);
  if (!doc) {
    return null;
  }

  const markdown = new vscode.MarkdownString();
  markdown.appendMarkdown(`**${key}**\n\n${localizeManifestText(locale, doc)}`);
  if (key === "language.version") {
    markdown.appendMarkdown(`\n\n${locale === "zh-CN" ? "可选值" : "Accepted values"}：\`${manifestLanguageVersions.join("`, `")}\``);
  }
  if (key === "targets.kind") {
    markdown.appendMarkdown(`\n\n${locale === "zh-CN" ? "可选值" : "Accepted values"}：\`${manifestTargetKindValues.join("`, `")}\``);
  }
  markdown.isTrusted = false;
  return markdown;
}

function createManifestCompletionItem(label, kind, documentation, insertText) {
  const item = new vscode.CompletionItem(label, kind);
  item.insertText = insertText || label;
  item.documentation = documentation ? new vscode.MarkdownString(documentation) : undefined;
  item.sortText = `0_${label}`;
  return item;
}

function getManifestCompletionItems(document, position, locale) {
  const section = getManifestSectionName(document, position.line);
  const lineText = document.lineAt(position.line).text;
  const beforeCursor = lineText.slice(0, position.character);
  const assignment = parseManifestAssignment(lineText);
  const expectingValue = assignment && beforeCursor.includes("=");
  const items = [];

  if (expectingValue) {
    if (assignment.key === "version") {
      for (const value of manifestLanguageVersions) {
        items.push(createManifestCompletionItem(
          value,
          vscode.CompletionItemKind.EnumMember,
          createManifestMarkdown("language.version", locale)?.value,
          `"${value}"`
        ));
      }
    } else if (assignment.key === "kind") {
      for (const value of manifestTargetKindValues) {
        items.push(createManifestCompletionItem(
          value,
          vscode.CompletionItemKind.EnumMember,
          createManifestMarkdown("targets.kind", locale)?.value,
          `"${value}"`
        ));
      }
    } else if (assignment.key === "noImplicitStdlib") {
      for (const value of ["true", "false"]) {
        items.push(createManifestCompletionItem(value, vscode.CompletionItemKind.Value, value, value));
      }
    }

    return items;
  }

  if (!section) {
    for (const key of manifestTopLevelKeys) {
      items.push(createManifestCompletionItem(
        key,
        manifestFieldDocs[key]?.kind || vscode.CompletionItemKind.Property,
        createManifestMarkdown(key, locale)?.value,
        `${key} = `
      ));
    }

    items.push(createManifestCompletionItem("[package]", vscode.CompletionItemKind.Module, localizeManifestText(locale, manifestSnippetDetails.tablePackage), "[package]"));
    items.push(createManifestCompletionItem("[language]", vscode.CompletionItemKind.Module, localizeManifestText(locale, manifestSnippetDetails.tableLanguage), "[language]"));
    items.push(createManifestCompletionItem("[dependencies]", vscode.CompletionItemKind.Module, localizeManifestText(locale, manifestSnippetDetails.tableDependencies), "[dependencies]"));
    items.push(createManifestCompletionItem("[ffi]", vscode.CompletionItemKind.Module, localizeManifestText(locale, manifestSnippetDetails.tableFfi), "[ffi]"));
    items.push(createManifestCompletionItem("[[targets]]", vscode.CompletionItemKind.Module, localizeManifestText(locale, manifestSnippetDetails.tableTargets), "[[targets]]"));
    return items;
  }

  const sectionKeys = manifestSectionKeys.get(section);
  if (sectionKeys) {
    for (const key of sectionKeys) {
      const docKey = `${section}.${key}`;
      items.push(createManifestCompletionItem(
        key,
        manifestFieldDocs[docKey]?.kind || vscode.CompletionItemKind.Property,
        createManifestMarkdown(docKey, locale)?.value,
        `${key} = `
      ));
    }
  }

  if (section === "ffi") {
    items.push(createManifestCompletionItem("[ffi.platform]", vscode.CompletionItemKind.Module, createManifestMarkdown("ffi.platform", locale)?.value, "[ffi.platform]"));
  }

  return items;
}

function validateManifestDocument(document, locale) {
  const diagnostics = [];
  let currentSection = null;
  for (let lineNumber = 0; lineNumber < document.lineCount; lineNumber += 1) {
    const line = document.lineAt(lineNumber);
    const text = line.text.replace(/#.*$/, "").trim();
    if (!text) {
      continue;
    }

    const targetArrayMatch = /^\[\[\s*([A-Za-z0-9_.-]+)\s*\]\]$/.exec(text);
    if (targetArrayMatch) {
      currentSection = targetArrayMatch[1];
      if (currentSection !== "targets") {
        diagnostics.push(new vscode.Diagnostic(
          line.range,
          locale === "zh-CN" ? `未知数组表：${currentSection}` : `Unknown array table: ${currentSection}`,
          vscode.DiagnosticSeverity.Warning
        ));
      }
      continue;
    }

    const sectionMatch = /^\[\s*([A-Za-z0-9_.-]+)\s*\]$/.exec(text);
    if (sectionMatch) {
      currentSection = sectionMatch[1];
      if (!manifestSectionKeys.has(currentSection)) {
        diagnostics.push(new vscode.Diagnostic(
          line.range,
          locale === "zh-CN" ? `未知表：${currentSection}` : `Unknown table: ${currentSection}`,
          vscode.DiagnosticSeverity.Warning
        ));
      }
      continue;
    }

    const assignment = parseManifestAssignment(line.text);
    if (!assignment) {
      continue;
    }

    const keyRange = new vscode.Range(lineNumber, line.firstNonWhitespaceCharacterIndex, lineNumber, line.firstNonWhitespaceCharacterIndex + assignment.key.length);
    if (!currentSection) {
      if (!manifestTopLevelKeys.has(assignment.key)) {
        diagnostics.push(new vscode.Diagnostic(
          keyRange,
          locale === "zh-CN" ? `未知顶层字段：${assignment.key}` : `Unknown top-level field: ${assignment.key}`,
          vscode.DiagnosticSeverity.Warning
        ));
      }
    } else {
      const allowed = manifestSectionKeys.get(currentSection);
      if (allowed && !allowed.has(assignment.key)) {
        diagnostics.push(new vscode.Diagnostic(
          keyRange,
          locale === "zh-CN" ? `未知字段：${currentSection}.${assignment.key}` : `Unknown field: ${currentSection}.${assignment.key}`,
          vscode.DiagnosticSeverity.Warning
        ));
      }
    }

    if (currentSection === "language" && assignment.key === "version") {
      const rawValue = assignment.valueText.trim().replace(/^"(.*)"$/, "$1");
      if (rawValue && !manifestLanguageVersions.includes(rawValue)) {
        diagnostics.push(new vscode.Diagnostic(
          line.range,
          locale === "zh-CN"
            ? `不支持的 language.version：${rawValue}。可选值：${manifestLanguageVersions.join(", ")}`
            : `Unsupported language.version: ${rawValue}. Accepted values: ${manifestLanguageVersions.join(", ")}`,
          vscode.DiagnosticSeverity.Error
        ));
      }
    }

    if (currentSection === "targets" && assignment.key === "kind") {
      const rawValue = assignment.valueText.trim().replace(/^"(.*)"$/, "$1");
      if (rawValue && !manifestTargetKindValues.includes(rawValue)) {
        diagnostics.push(new vscode.Diagnostic(
          line.range,
          locale === "zh-CN"
            ? `不支持的 target kind：${rawValue}。可选值：${manifestTargetKindValues.join(", ")}`
            : `Unsupported target kind: ${rawValue}. Accepted values: ${manifestTargetKindValues.join(", ")}`,
          vscode.DiagnosticSeverity.Error
        ));
      }
    }
  }

  return diagnostics;
}

function inferExecutionRoot(filePath) {
  const folders = vscode.workspace.workspaceFolders ?? [];
  if (folders.length > 0) {
    if (filePath && isAbsolutePath(filePath)) {
      const normalizedFile = filePath.toLowerCase();
      for (const folder of folders) {
        const root = folder.uri.fsPath;
        const normalizedRoot = root.toLowerCase();
        if (normalizedFile === normalizedRoot || normalizedFile.startsWith(normalizedRoot + path.sep.toLowerCase())) {
          return root;
        }
      }
    }

    return folders[0].uri.fsPath;
  }

  if (filePath && isAbsolutePath(filePath)) {
    const candidate = path.extname(filePath) ? path.dirname(filePath) : filePath;
    if (pathExists(candidate)) {
      return candidate;
    }
  }

  return process.cwd();
}

function isCommandAvailable(command, cwd) {
  if (!command || typeof command !== "string") {
    return false;
  }

  const cacheKey = `${command}@@${cwd || ""}`;
  const now = Date.now();
  const cached = commandProbeCache.get(cacheKey);
  if (cached && now - cached.checkedAt <= COMMAND_PROBE_TTL_MS) {
    return cached.available;
  }

  let available = false;
  try {
    const probe = cp.spawnSync(command, ["--help"], {
      cwd: cwd || process.cwd(),
      shell: false,
      stdio: "ignore"
    });

    if (probe.error && probe.error.code === "ENOENT") {
      available = false;
    } else {
      available = true;
    }
  } catch {
    available = false;
  }

  commandProbeCache.set(cacheKey, { available, checkedAt: now });
  return available;
}

function isNativeExecutableCommand(command) {
  if (!command || typeof command !== "string") {
    return false;
  }

  if (process.platform !== "win32") {
    return true;
  }

  const extension = path.extname(command).toLowerCase();
  return extension !== ".cmd" && extension !== ".bat" && extension !== ".ps1";
}

function getBundledCliPath() {
  if (!extensionRoot) {
    return null;
  }

  const exe = process.platform === "win32" ? "eidosc.exe" : "eidosc";
  const candidates = [
    path.join(extensionRoot, "bin", exe),
    path.join(extensionRoot, "bin", process.platform, exe),
    path.join(extensionRoot, "server", exe),
    path.join(extensionRoot, "server", process.platform, exe)
  ];

  const found = candidates.find(pathExists);
  return found ?? null;
}

function discoverDotnetProject(startPath) {
  if (!startPath) {
    return null;
  }

  let current = startPath;
  if (path.extname(current)) {
    current = path.dirname(current);
  }

  while (current && path.dirname(current) !== current) {
    const candidates = [
      path.join(current, "Eidosc", "src", "Eidosc.Cli", "Eidosc.Cli.csproj"),
      path.join(current, "Eidosc", "src", "Eidosc.Cli"),
      path.join(current, "src", "Eidosc", "Eidosc.Cli", "Eidosc.Cli.csproj"),
      path.join(current, "src", "Eidosc", "Eidosc.Cli"),
      path.join(current, "Eidosc.Cli", "Eidosc.Cli.csproj"),
      path.join(current, "Eidosc.Cli")
    ];

    for (const candidate of candidates) {
      if (pathExists(candidate)) {
        return candidate;
      }
    }

    current = path.dirname(current);
  }

  return null;
}

function resolveDotnetProject(workspace, filePath) {
  const config = vscode.workspace.getConfiguration("eidosc");
  const configured = config.get("dotnetProject", "Eidosc/src/Eidosc.Cli");
  const cacheKey = `${workspace || ""}|${configured}`;
  const cached = dotnetProjectCache.get(cacheKey);
  if (cached && pathExists(cached)) {
    return cached;
  }

  const candidates = [];
  const searched = new Set();

  if (isAbsolutePath(configured)) {
    if (pathExists(configured)) {
      return configured;
    }
    return null;
  } else {
    if (workspace && pathExists(workspace)) {
      candidates.push(path.resolve(workspace, configured));
    }

    if (filePath && isAbsolutePath(filePath)) {
      candidates.push(path.resolve(path.dirname(filePath), configured));
    }
  }

  if (filePath && isAbsolutePath(filePath)) {
    const discoveredFromFile = discoverDotnetProject(filePath);
    if (discoveredFromFile) {
      candidates.push(discoveredFromFile);
    }
  }

  if (workspace && pathExists(workspace)) {
    const discoveredFromWorkspace = discoverDotnetProject(workspace);
    if (discoveredFromWorkspace) {
      candidates.push(discoveredFromWorkspace);
    }
  }

  for (const doc of vscode.workspace.textDocuments ?? []) {
    if (doc.uri?.scheme !== "file") {
      continue;
    }
    const discovered = discoverDotnetProject(doc.uri.fsPath);
    if (discovered) {
      candidates.push(discovered);
    }
  }

  for (const candidate of candidates) {
    if (!candidate || searched.has(candidate)) {
      continue;
    }
    searched.add(candidate);
    if (pathExists(candidate)) {
      dotnetProjectCache.set(cacheKey, candidate);
      return candidate;
    }
  }

  return null;
}

function buildCommand(filePath) {
  const config = vscode.workspace.getConfiguration("eidosc");
  const cliMode = config.get("cliMode", "auto");
  const cliPath = config.get("cliPath", "eidosc");
  const dotnetPath = config.get("dotnetPath", "dotnet");
  const phase = config.get("phase", "borrow");
  const extraArgs = config.get("extraArgs", []);
  const workspace = inferExecutionRoot(filePath);
  const dotnetNoBuild = config.get("dotnetNoBuild", true);

  const nativeCommand = () => ({
    command: cliPath,
    args: ["analyze", filePath, "--phase", phase, ...extraArgs],
    cwd: workspace
  });

  const bundledCli = getBundledCliPath();
  const bundledCommand = () => ({
    command: bundledCli,
    args: ["analyze", filePath, "--phase", phase, ...extraArgs],
    cwd: workspace
  });

  const dotnetCommand = () => {
    const projectPath = resolveDotnetProject(workspace, filePath);
    if (!projectPath) {
      return null;
    }

    return {
      command: dotnetPath,
      args: ["run", "--project", projectPath, ...(dotnetNoBuild ? ["--no-build"] : []), "--", "analyze", filePath, "--phase", phase, ...extraArgs],
      cwd: workspace
    };
  };

  if (cliMode === "native") {
    if (isCommandAvailable(cliPath, workspace)) {
      return nativeCommand();
    }
    if (bundledCli) {
      return bundledCommand();
    }
    return { error: `Native eidosc not found: '${cliPath}'. Install eidosc to PATH or set eidosc.cliPath.` };
  }

  if (cliMode === "dotnet") {
    if (!isCommandAvailable(dotnetPath, workspace)) {
      return { error: `dotnet not found: '${dotnetPath}'. Install .NET SDK or set eidosc.dotnetPath.` };
    }
    const dot = dotnetCommand();
    return dot ?? { error: "Cannot resolve eidosc.dotnetProject. Open repository root or set an absolute project path." };
  }

  if (isCommandAvailable(dotnetPath, workspace)) {
    const dot = dotnetCommand();
    if (dot) {
      return dot;
    }
  }

  if (bundledCli) {
    return bundledCommand();
  }

  if (isCommandAvailable(cliPath, workspace)) {
    return nativeCommand();
  }

  return {
    error: "No runnable eidosc backend found. Install eidosc (PATH), bundle binary, or configure eidosc.dotnetProject + eidosc.dotnetPath."
  };
}

function buildIdeCommand(filePath) {
  const config = vscode.workspace.getConfiguration("eidosc");
  const cliMode = config.get("cliMode", "auto");
  const cliPath = config.get("cliPath", "eidosc");
  const dotnetPath = config.get("dotnetPath", "dotnet");
  const semanticPhase = config.get("semanticPhase", "types");
  const semanticExtraArgs = config.get("semanticExtraArgs", []);
  const workspace = inferExecutionRoot(filePath);
  const dotnetNoBuild = config.get("dotnetNoBuild", true);
  const projectRoot = findProjectRoot(filePath);
  const configuredTargetName = String(config.get("package.targetName", "") || "").trim();
  const hasExplicitProjectArg = semanticExtraArgs.includes("--project");
  const hasExplicitTargetNameArg = semanticExtraArgs.includes("--target-name");
  const projectArgs = projectRoot && !hasExplicitProjectArg
    ? ["--project", projectRoot, ...(configuredTargetName && !hasExplicitTargetNameArg ? ["--target-name", configuredTargetName] : [])]
    : [];

  const nativeCommand = (commandPath) => ({
    command: commandPath,
    args: ["ide", filePath, "--stdin", ...projectArgs, "--phase", semanticPhase, ...semanticExtraArgs],
    cwd: workspace
  });

  const dotnetCommand = () => {
    const projectPath = resolveDotnetProject(workspace, filePath);
    if (!projectPath) {
      return null;
    }

    return {
      command: dotnetPath,
      args: ["run", "--project", projectPath, ...(dotnetNoBuild ? ["--no-build"] : []), "--", "ide", filePath, "--stdin", ...projectArgs, "--phase", semanticPhase, ...semanticExtraArgs],
      cwd: workspace
    };
  };

  const bundledCli = getBundledCliPath();

  if (cliMode === "native") {
    if (isCommandAvailable(cliPath, workspace)) {
      return nativeCommand(cliPath);
    }
    if (bundledCli) {
      return nativeCommand(bundledCli);
    }
    return { error: `Native eidosc not found: '${cliPath}'. Install eidosc to PATH or set eidosc.cliPath.` };
  }

  if (cliMode === "dotnet") {
    if (!isCommandAvailable(dotnetPath, workspace)) {
      return { error: `dotnet not found: '${dotnetPath}'. Install .NET SDK or set eidosc.dotnetPath.` };
    }
    const dot = dotnetCommand();
    return dot ?? { error: "Cannot resolve eidosc.dotnetProject. Open repository root or set an absolute project path." };
  }

  if (bundledCli) {
    return nativeCommand(bundledCli);
  }

  if (isNativeExecutableCommand(cliPath) && isCommandAvailable(cliPath, workspace)) {
    return nativeCommand(cliPath);
  }

  if (isCommandAvailable(dotnetPath, workspace)) {
    const dot = dotnetCommand();
    if (dot) {
      return dot;
    }
  }

  if (isCommandAvailable(cliPath, workspace)) {
    return nativeCommand(cliPath);
  }

  return {
    error: "No runnable eidosc backend found. Install eidosc (PATH), bundle binary, or configure eidosc.dotnetProject + eidosc.dotnetPath."
  };
}

function buildFormatCommand(filePath, formattingOptions) {
  const config = vscode.workspace.getConfiguration("eidosc");
  const cliMode = config.get("cliMode", "auto");
  const cliPath = config.get("cliPath", "eidosc");
  const dotnetPath = config.get("dotnetPath", "dotnet");
  const workspace = inferExecutionRoot(filePath);
  const dotnetNoBuild = config.get("dotnetNoBuild", true);
  const indentSize = Math.max(1, Number(config.get("format.indentSize", formattingOptions?.tabSize ?? 4)) || 4);
  const maxLineLength = Math.max(40, Number(config.get("format.maxLineLength", 100)) || 100);
  const finalNewline = config.get("format.finalNewline", true);
  const validate = config.get("format.validateSyntax", true);
  const formatArgs = [
    "fmt",
    filePath || "stdin.eidos",
    "--stdin",
    "--indent-size",
    String(indentSize),
    "--max-line-length",
    String(maxLineLength)
  ];
  if (!finalNewline) {
    formatArgs.push("--no-final-newline");
  }
  if (!validate) {
    formatArgs.push("--no-validate");
  }

  const nativeCommand = (commandPath) => ({
    command: commandPath,
    args: formatArgs,
    cwd: workspace
  });

  const dotnetCommand = () => {
    const projectPath = resolveDotnetProject(workspace, filePath);
    if (!projectPath) {
      return null;
    }

    return {
      command: dotnetPath,
      args: ["run", "--project", projectPath, ...(dotnetNoBuild ? ["--no-build"] : []), "--", ...formatArgs],
      cwd: workspace
    };
  };

  const bundledCli = getBundledCliPath();

  if (cliMode === "native") {
    if (isCommandAvailable(cliPath, workspace)) {
      return nativeCommand(cliPath);
    }
    if (bundledCli) {
      return nativeCommand(bundledCli);
    }
    return { error: `Native eidosc not found: '${cliPath}'. Install eidosc to PATH or set eidosc.cliPath.` };
  }

  if (cliMode === "dotnet") {
    if (!isCommandAvailable(dotnetPath, workspace)) {
      return { error: `dotnet not found: '${dotnetPath}'. Install .NET SDK or set eidosc.dotnetPath.` };
    }
    const dot = dotnetCommand();
    return dot ?? { error: "Cannot resolve eidosc.dotnetProject. Open repository root or set an absolute project path." };
  }

  if (isCommandAvailable(dotnetPath, workspace)) {
    const dot = dotnetCommand();
    if (dot) {
      return dot;
    }
  }

  if (bundledCli) {
    return nativeCommand(bundledCli);
  }

  if (isCommandAvailable(cliPath, workspace)) {
    return nativeCommand(cliPath);
  }

  return {
    error: "No runnable eidosc backend found. Install eidosc (PATH), bundle binary, or configure eidosc.dotnetProject + eidosc.dotnetPath."
  };
}

function findProjectRoot(startPath) {
  if (!startPath) {
    return null;
  }

  let current = path.extname(startPath) ? path.dirname(startPath) : startPath;
  while (current && path.dirname(current) !== current) {
    const manifest = path.join(current, "eidos.toml");
    if (pathExists(manifest)) {
      return current;
    }

    current = path.dirname(current);
  }

  return null;
}

function getActiveEidosDocument() {
  const editor = vscode.window.activeTextEditor;
  const document = editor?.document;
  if (!document) {
    return null;
  }

  if (isProjectAwareDocument(document)) {
    return document;
  }

  return null;
}

function getCommandTarget(document) {
  const filePath = document?.uri?.scheme === "file" ? document.fileName : undefined;
  const workspace = inferExecutionRoot(filePath);
  const projectRoot = findProjectRoot(filePath) || findProjectRoot(workspace);
  return {
    filePath,
    workspace,
    projectRoot,
    source: projectRoot || filePath || workspace
  };
}

function buildCliCommand(filePath, eidosArgs, cwdOverride) {
  const config = vscode.workspace.getConfiguration("eidosc");
  const cliMode = config.get("cliMode", "auto");
  const cliPath = config.get("cliPath", "eidosc");
  const dotnetPath = config.get("dotnetPath", "dotnet");
  const workspace = inferExecutionRoot(filePath);
  const cwd = cwdOverride || workspace;
  const dotnetNoBuild = config.get("dotnetNoBuild", true);

  const nativeCommand = (commandPath) => ({
    command: commandPath,
    args: eidosArgs,
    cwd
  });

  const dotnetCommand = () => {
    const projectPath = resolveDotnetProject(workspace, filePath);
    if (!projectPath) {
      return null;
    }

    return {
      command: dotnetPath,
      args: ["run", "--project", projectPath, ...(dotnetNoBuild ? ["--no-build"] : []), "--", ...eidosArgs],
      cwd
    };
  };

  const bundledCli = getBundledCliPath();

  if (cliMode === "native") {
    if (isCommandAvailable(cliPath, cwd)) {
      return nativeCommand(cliPath);
    }
    if (bundledCli) {
      return nativeCommand(bundledCli);
    }
    return { error: `Native eidosc not found: '${cliPath}'. Install eidosc to PATH or set eidosc.cliPath.` };
  }

  if (cliMode === "dotnet") {
    if (!isCommandAvailable(dotnetPath, cwd)) {
      return { error: `dotnet not found: '${dotnetPath}'. Install .NET SDK or set eidosc.dotnetPath.` };
    }
    const dot = dotnetCommand();
    return dot ?? { error: "Cannot resolve eidosc.dotnetProject. Open repository root or set an absolute project path." };
  }

  if (isCommandAvailable(dotnetPath, cwd)) {
    const dot = dotnetCommand();
    if (dot) {
      return dot;
    }
  }

  if (bundledCli) {
    return nativeCommand(bundledCli);
  }

  if (isCommandAvailable(cliPath, cwd)) {
    return nativeCommand(cliPath);
  }

  return {
    error: "No runnable eidosc backend found. Install eidosc (PATH), bundle binary, or configure eidosc.dotnetProject + eidosc.dotnetPath."
  };
}

function buildProjectArgs(command, target) {
  const config = vscode.workspace.getConfiguration("eidosc");
  const args = [command];
  if (target.source) {
    args.push(target.source);
  }

  const targetName = config.get("package.targetName", "");
  if (targetName && typeof targetName === "string" && targetName.trim().length > 0) {
    args.push("--target-name", targetName.trim());
  }

  if (command === "run") {
    const runArgs = config.get("run.args", []);
    if (Array.isArray(runArgs) && runArgs.length > 0) {
      args.push("--", ...runArgs.map(String));
    }
  }

  return args;
}

function buildPackageArgs(subcommand) {
  return ["pkg", subcommand];
}

function createCancellationSource() {
  let cancelled = false;
  const callbacks = [];
  return {
    token: {
      get isCancellationRequested() {
        return cancelled;
      },
      onCancellationRequested(callback) {
        if (cancelled) {
          callback();
          return;
        }
        callbacks.push(callback);
      }
    },
    cancel() {
      if (cancelled) {
        return;
      }
      cancelled = true;
      for (const callback of callbacks.splice(0)) {
        callback();
      }
    }
  };
}

function spawnProcess(command, args, cwd, stdinText, cancellationToken) {
  return new Promise((resolve) => {
    if (cancellationToken?.isCancellationRequested) {
      resolve({ code: null, stdout: "", stderr: "", error: null, cancelled: true });
      return;
    }

    const child = cp.spawn(command, args, { cwd, shell: false });
    let stdout = "";
    let stderr = "";
    let spawnError = null;
    let cancelled = false;

    cancellationToken?.onCancellationRequested(() => {
      cancelled = true;
      try {
        child.kill();
      } catch {
        // Ignore cancellation races with process exit.
      }
    });

    child.stdout.on("data", (data) => {
      stdout += data.toString();
    });
    child.stderr.on("data", (data) => {
      stderr += data.toString();
    });
    child.on("error", (error) => {
      spawnError = error;
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr, error: spawnError, cancelled });
    });

    if (typeof stdinText === "string") {
      child.stdin.write(stdinText);
      child.stdin.end();
    }
  });
}

function parseJsonFromOutput(output) {
  const text = (output || "").trim();
  if (!text) {
    throw new Error("Empty JSON output from eidosc ide.");
  }

  try {
    return JSON.parse(text);
  } catch {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(text.slice(start, end + 1));
    }

    throw new Error(`Invalid JSON output: ${text.slice(0, 400)}`);
  }
}

class EidosLspClient {
  constructor(output, diagnostics) {
    this.output = output;
    this.diagnostics = diagnostics;
    this.child = null;
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = Buffer.alloc(0);
    this.initialized = false;
    this.starting = null;
    this.openDocuments = new Map();
    this.disabledUntil = 0;
    this.lastFailure = null;
  }

  isAvailable() {
    return Date.now() >= this.disabledUntil;
  }

  markFailure(error) {
    this.lastFailure = error?.message || String(error || "LSP backend failed.");
    this.disabledUntil = Date.now() + LSP_FAILURE_COOLDOWN_MS;
  }

  async start(document) {
    if (!this.isAvailable()) {
      return false;
    }
    if (this.child && this.initialized) {
      return true;
    }
    if (this.starting) {
      return await this.starting;
    }

    this.starting = this.startCore(document).finally(() => {
      this.starting = null;
    });
    return await this.starting;
  }

  async startCore(document) {
    const built = buildCliCommand(document?.fileName, ["lsp"]);
    if (built.error) {
      this.output.appendLine(`[eidosc][lsp] ${built.error}`);
      this.markFailure(new Error(built.error));
      return false;
    }

    const { command, args, cwd } = built;
    this.child = cp.spawn(command, args, { cwd, shell: false });
    this.initialized = false;
    this.buffer = Buffer.alloc(0);

    this.child.stdout.on("data", (data) => this.handleData(data));
    this.child.stderr.on("data", (data) => {
      const text = data.toString().trim();
      if (text) {
        this.output.appendLine(`[eidosc][lsp][stderr] ${text}`);
      }
    });
    this.child.on("error", (error) => {
      this.output.appendLine(`[eidosc][lsp] ${error.message}`);
      this.markFailure(error);
      this.rejectPending(error);
    });
    this.child.on("close", (code) => {
      this.output.appendLine(`[eidosc][lsp] server exited with code ${code}`);
      this.child = null;
      this.initialized = false;
      this.markFailure(new Error(`eidosc lsp exited with code ${code}`));
      this.rejectPending(new Error(`eidosc lsp exited with code ${code}`));
    });

    try {
      await this.request("initialize", {
        processId: process.pid,
        rootUri: document?.uri?.scheme === "file" ? vscode.Uri.file(inferExecutionRoot(document.fileName)).toString() : null,
        capabilities: {}
      });
      this.notify("initialized", {});
      this.initialized = true;
      this.lastFailure = null;
      for (const openDocument of vscode.workspace.textDocuments) {
        if (isEidosSourceDocument(openDocument)) {
          this.didOpen(openDocument);
        }
      }
      return true;
    } catch (error) {
      this.output.appendLine(`[eidosc][lsp] initialize failed: ${error.message}`);
      this.markFailure(error);
      this.stop();
      return false;
    }
  }

  stop() {
    if (!this.child) {
      return;
    }

    try {
      if (this.initialized) {
        this.request("shutdown", {}).finally(() => {
          this.notify("exit", {});
          this.child?.kill();
        });
      } else {
        this.child.kill();
      }
    } catch {
      try {
        this.child.kill();
      } catch {
      }
    }
    this.child = null;
    this.initialized = false;
    this.openDocuments.clear();
  }

  dispose() {
    this.stop();
    this.rejectPending(new Error("Eidos LSP client disposed."));
  }

  async ensureStarted(document) {
    if (!isEidosSourceDocument(document)) {
      return false;
    }
    return await this.start(document);
  }

  async syncDocument(document) {
    if (!(await this.ensureStarted(document))) {
      return false;
    }

    const key = document.uri.toString();
    if (this.openDocuments.has(key)) {
      if (this.openDocuments.get(key) !== document.version) {
        this.didChange(document);
      }
    } else {
      this.didOpen(document);
    }
    return true;
  }

  documentParams(document) {
    return {
      textDocument: { uri: document.uri.toString() }
    };
  }

  positionParams(document, position) {
    return {
      textDocument: { uri: document.uri.toString() },
      position: {
        line: position.line,
        character: position.character
      }
    };
  }

  rangeParams(document, range) {
    return {
      textDocument: { uri: document.uri.toString() },
      range: {
        start: {
          line: range.start.line,
          character: range.start.character
        },
        end: {
          line: range.end.line,
          character: range.end.character
        }
      }
    };
  }

  async completion(document, position) {
    if (!(await this.syncDocument(document))) {
      return null;
    }
    return await this.request("textDocument/completion", this.positionParams(document, position));
  }

  async hover(document, position) {
    if (!(await this.syncDocument(document))) {
      return null;
    }
    return await this.request("textDocument/hover", this.positionParams(document, position));
  }

  async definition(document, position) {
    if (!(await this.syncDocument(document))) {
      return null;
    }
    return await this.request("textDocument/definition", this.positionParams(document, position));
  }

  async references(document, position, includeDeclaration) {
    if (!(await this.syncDocument(document))) {
      return null;
    }
    return await this.request("textDocument/references", {
      ...this.positionParams(document, position),
      context: { includeDeclaration: !!includeDeclaration }
    });
  }

  async documentSymbols(document) {
    if (!(await this.syncDocument(document))) {
      return null;
    }
    return await this.request("textDocument/documentSymbol", this.documentParams(document));
  }

  async codeActions(document, range, context) {
    if (!(await this.syncDocument(document))) {
      return null;
    }
    return await this.request("textDocument/codeAction", {
      ...this.rangeParams(document, range),
      context: {
        diagnostics: (context?.diagnostics ?? []).map((diagnostic) => ({
          range: {
            start: {
              line: diagnostic.range.start.line,
              character: diagnostic.range.start.character
            },
            end: {
              line: diagnostic.range.end.line,
              character: diagnostic.range.end.character
            }
          },
          severity: diagnostic.severity === vscode.DiagnosticSeverity.Warning
            ? 2
            : diagnostic.severity === vscode.DiagnosticSeverity.Information
              ? 3
              : diagnostic.severity === vscode.DiagnosticSeverity.Hint
                ? 4
                : 1,
          code: diagnostic.code,
          source: diagnostic.source,
          message: diagnostic.message
        }))
      }
    });
  }

  async semanticTokens(document) {
    if (!(await this.syncDocument(document))) {
      return null;
    }
    return await this.request("textDocument/semanticTokens/full", this.documentParams(document));
  }

  async inlayHints(document, range) {
    if (!(await this.syncDocument(document))) {
      return null;
    }
    return await this.request("textDocument/inlayHint", this.rangeParams(document, range));
  }

  async generatedDocument(uri, sourceDocument) {
    if ((!this.child || !this.initialized) && sourceDocument) {
      if (!(await this.start(sourceDocument))) {
        return null;
      }
    }
    if (!this.child || !this.initialized) {
      return null;
    }
    return await this.request("eidos/generatedDocument", { uri });
  }

  didOpen(document) {
    const key = document.uri.toString();
    this.openDocuments.set(key, document.version);
    this.notify("textDocument/didOpen", {
      textDocument: {
        uri: key,
        languageId: "eidos",
        version: document.version,
        text: document.getText()
      }
    });
  }

  didChange(document) {
    const key = document.uri.toString();
    this.openDocuments.set(key, document.version);
    this.notify("textDocument/didChange", {
      textDocument: {
        uri: key,
        version: document.version
      },
      contentChanges: [{ text: document.getText() }]
    });
  }

  didClose(document) {
    const key = document.uri.toString();
    if (!this.openDocuments.delete(key) || !this.child || !this.initialized) {
      return;
    }
    this.notify("textDocument/didClose", {
      textDocument: { uri: key }
    });
  }

  notify(method, params) {
    this.send({ jsonrpc: "2.0", method, params });
  }

  request(method, params) {
    const id = this.nextId++;
    const promise = new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
    });
    this.send({ jsonrpc: "2.0", id, method, params });
    return promise;
  }

  send(message) {
    if (!this.child?.stdin.writable) {
      return;
    }

    const body = Buffer.from(JSON.stringify(message), "utf8");
    const header = Buffer.from(`Content-Length: ${body.length}\r\n\r\n`, "ascii");
    this.child.stdin.write(Buffer.concat([header, body]));
  }

  handleData(data) {
    this.buffer = Buffer.concat([this.buffer, data]);
    while (true) {
      const headerEnd = this.buffer.indexOf("\r\n\r\n");
      if (headerEnd < 0) {
        return;
      }

      const header = this.buffer.subarray(0, headerEnd).toString("ascii");
      const match = /Content-Length:\s*(\d+)/i.exec(header);
      if (!match) {
        this.buffer = this.buffer.subarray(headerEnd + 4);
        continue;
      }

      const length = Number(match[1]);
      const messageStart = headerEnd + 4;
      const messageEnd = messageStart + length;
      if (this.buffer.length < messageEnd) {
        return;
      }

      const payload = this.buffer.subarray(messageStart, messageEnd).toString("utf8");
      this.buffer = this.buffer.subarray(messageEnd);
      try {
        this.handleMessage(JSON.parse(payload));
      } catch (error) {
        this.output.appendLine(`[eidosc][lsp] invalid message: ${error.message}`);
      }
    }
  }

  handleMessage(message) {
    if (Object.prototype.hasOwnProperty.call(message, "id") &&
        (Object.prototype.hasOwnProperty.call(message, "result") || Object.prototype.hasOwnProperty.call(message, "error"))) {
      const pending = this.pending.get(message.id);
      if (!pending) {
        return;
      }
      this.pending.delete(message.id);
      if (message.error) {
        pending.reject(new Error(message.error.message || "LSP request failed."));
      } else {
        pending.resolve(message.result);
      }
      return;
    }

    if (message.method === "textDocument/publishDiagnostics") {
      this.applyPublishDiagnostics(message.params);
    }
  }

  applyPublishDiagnostics(params) {
    if (!params?.uri) {
      return;
    }

    const uri = vscode.Uri.parse(params.uri);
    const items = (params.diagnostics ?? []).map((diagnostic) => {
      const item = new vscode.Diagnostic(
        toVsCodeRange(diagnostic.range),
        diagnostic.message || "diagnostic",
        mapLspDiagnosticSeverity(diagnostic.severity)
      );
      item.source = diagnostic.source || "eidosc";
      if (diagnostic.code) {
        item.code = diagnostic.code;
      }
      if (Array.isArray(diagnostic.relatedInformation)) {
        item.relatedInformation = diagnostic.relatedInformation.map((related) =>
          new vscode.DiagnosticRelatedInformation(
            new vscode.Location(vscode.Uri.parse(related.location.uri), toVsCodeRange(related.location.range)),
            related.message || ""
          ));
      }
      return item;
    });
    this.diagnostics.set(uri, items);
  }

  rejectPending(error) {
    for (const pending of this.pending.values()) {
      pending.reject(error);
    }
    this.pending.clear();
  }
}

function toVsCodeRange(range) {
  return new vscode.Range(
    new vscode.Position(range?.start?.line ?? 0, range?.start?.character ?? 0),
    new vscode.Position(range?.end?.line ?? range?.start?.line ?? 0, range?.end?.character ?? range?.start?.character ?? 1)
  );
}

function mapLspDiagnosticSeverity(severity) {
  switch (severity) {
    case 2:
      return vscode.DiagnosticSeverity.Warning;
    case 3:
      return vscode.DiagnosticSeverity.Information;
    case 4:
      return vscode.DiagnosticSeverity.Hint;
    case 1:
    default:
      return vscode.DiagnosticSeverity.Error;
  }
}

function mapLspCompletionKind(kind) {
  switch (kind) {
    case 2:
      return vscode.CompletionItemKind.Method;
    case 3:
      return vscode.CompletionItemKind.Function;
    case 4:
      return vscode.CompletionItemKind.Constructor;
    case 5:
      return vscode.CompletionItemKind.Field;
    case 6:
      return vscode.CompletionItemKind.Variable;
    case 7:
      return vscode.CompletionItemKind.Class;
    case 8:
      return vscode.CompletionItemKind.Interface;
    case 9:
      return vscode.CompletionItemKind.Module;
    case 10:
      return vscode.CompletionItemKind.Property;
    case 14:
      return vscode.CompletionItemKind.Keyword;
    case 25:
      return vscode.CompletionItemKind.TypeParameter;
    case 1:
    default:
      return vscode.CompletionItemKind.Text;
  }
}

function mapLspSymbolKind(kind) {
  switch (kind) {
    case 1:
      return vscode.SymbolKind.File;
    case 2:
    case 3:
    case 4:
      return vscode.SymbolKind.Module;
    case 5:
      return vscode.SymbolKind.Class;
    case 6:
      return vscode.SymbolKind.Method;
    case 7:
      return vscode.SymbolKind.Property;
    case 8:
      return vscode.SymbolKind.Field;
    case 9:
      return vscode.SymbolKind.Constructor;
    case 10:
      return vscode.SymbolKind.Enum;
    case 11:
      return vscode.SymbolKind.Interface;
    case 12:
      return vscode.SymbolKind.Function;
    case 13:
      return vscode.SymbolKind.Variable;
    case 14:
      return vscode.SymbolKind.Constant;
    case 23:
      return vscode.SymbolKind.Struct;
    case 26:
      return vscode.SymbolKind.TypeParameter;
    default:
      return vscode.SymbolKind.Object;
  }
}

function mapLspInlayHintKind(kind) {
  switch (kind) {
    case 1:
      return vscode.InlayHintKind.Type;
    case 2:
      return vscode.InlayHintKind.Parameter;
    default:
      return undefined;
  }
}

function lspLocationToVsCode(location) {
  if (!location?.uri) {
    return null;
  }
  return new vscode.Location(vscode.Uri.parse(location.uri), toVsCodeRange(location.range));
}

function lspTextEditToVsCode(edit) {
  if (!edit?.range) {
    return null;
  }
  return vscode.TextEdit.replace(toVsCodeRange(edit.range), edit.newText ?? "");
}

function lspCompletionItemToVsCode(item) {
  const completion = new vscode.CompletionItem(item.label ?? "", mapLspCompletionKind(item.kind));
  completion.detail = item.detail || undefined;
  completion.sortText = item.sortText || item.label || undefined;
  completion.insertText = item.insertText || item.label || "";
  if (item.documentation) {
    completion.documentation = new vscode.MarkdownString(String(item.documentation));
  }
  if (item.textEdit?.range) {
    completion.range = toVsCodeRange(item.textEdit.range);
    completion.insertText = item.textEdit.newText ?? completion.insertText;
  }
  return completion;
}

function lspMarkupToMarkdown(contents) {
  if (!contents) {
    return null;
  }
  if (typeof contents === "string") {
    return new vscode.MarkdownString(contents);
  }
  if (Array.isArray(contents)) {
    const markdown = new vscode.MarkdownString();
    for (const part of contents) {
      const value = lspMarkupToMarkdown(part);
      if (value?.value) {
        if (markdown.value) {
          markdown.appendMarkdown("\n\n");
        }
        markdown.appendMarkdown(value.value);
      }
    }
    return markdown.value ? markdown : null;
  }
  if (typeof contents.value === "string") {
    return new vscode.MarkdownString(contents.value);
  }
  if (typeof contents.language === "string" && typeof contents.value === "string") {
    return new vscode.MarkdownString(`\`\`\`${contents.language}\n${contents.value}\n\`\`\``);
  }
  return null;
}

function lspHoverToVsCode(hover) {
  const markdown = lspMarkupToMarkdown(hover?.contents);
  if (!markdown) {
    return null;
  }
  return hover.range
    ? new vscode.Hover(markdown, toVsCodeRange(hover.range))
    : new vscode.Hover(markdown);
}

function lspWorkspaceEditToVsCode(edit) {
  if (!edit?.changes) {
    return undefined;
  }

  const workspaceEdit = new vscode.WorkspaceEdit();
  for (const [uriText, edits] of Object.entries(edit.changes)) {
    const uri = vscode.Uri.parse(uriText);
    for (const textEdit of edits ?? []) {
      const mapped = lspTextEditToVsCode(textEdit);
      if (mapped) {
        workspaceEdit.replace(uri, mapped.range, mapped.newText);
      }
    }
  }
  return workspaceEdit;
}

function lspCodeActionToVsCode(action, diagnostics) {
  const codeAction = new vscode.CodeAction(
    action.title || "Code action",
    action.kind ? new vscode.CodeActionKind(action.kind) : vscode.CodeActionKind.QuickFix
  );
  codeAction.edit = lspWorkspaceEditToVsCode(action.edit);
  codeAction.isPreferred = action.isPreferred === true;
  if (diagnostics?.length) {
    codeAction.diagnostics = diagnostics;
  }
  return codeAction;
}

function lspDocumentSymbolToVsCode(symbol) {
  const mapped = new vscode.DocumentSymbol(
    symbol.name || "",
    symbol.detail || "",
    mapLspSymbolKind(symbol.kind),
    toVsCodeRange(symbol.range),
    toVsCodeRange(symbol.selectionRange || symbol.range)
  );
  mapped.children = (symbol.children ?? []).map(lspDocumentSymbolToVsCode);
  return mapped;
}

function lspInlayHintToVsCode(hint) {
  if (!hint?.position) {
    return null;
  }
  const mapped = new vscode.InlayHint(
    new vscode.Position(hint.position.line ?? 0, hint.position.character ?? 0),
    hint.label ?? "",
    mapLspInlayHintKind(hint.kind)
  );
  if (hint.tooltip) {
    mapped.tooltip = hint.tooltip;
  }
  mapped.paddingLeft = hint.paddingLeft === true;
  mapped.paddingRight = hint.paddingRight === true;
  return mapped;
}

const lspSemanticTokenTypes = [
  "module",
  "type",
  "class",
  "interface",
  "typeParameter",
  "function",
  "method",
  "property",
  "variable",
  "parameter",
  "keyword",
  "operator",
  "effect",
  "constructor"
];

function remapLspSemanticTokenData(data) {
  if (!Array.isArray(data) || data.length === 0) {
    return new Uint32Array();
  }

  const remapped = new Uint32Array(data.length);
  const tokenTypeMap = lspSemanticTokenTypes.map((name) => semanticTokenTypes.indexOf(name));
  for (let index = 0; index < data.length; index += 5) {
    remapped[index] = data[index] ?? 0;
    remapped[index + 1] = data[index + 1] ?? 0;
    remapped[index + 2] = data[index + 2] ?? 0;
    const mappedType = tokenTypeMap[data[index + 3] ?? -1];
    remapped[index + 3] = mappedType >= 0 ? mappedType : 0;
    remapped[index + 4] = data[index + 4] ?? 0;
  }
  return remapped;
}

function hasSpan(span) {
  return !!span && typeof span.startLine === "number" && typeof span.startCharacter === "number";
}

function normalizePathForCompare(target) {
  if (typeof target !== "string" || !target) {
    return "";
  }

  const normalized = isAbsolutePath(target) ? path.normalize(target) : target;
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function pathsEqual(left, right) {
  if (!left || !right) {
    return false;
  }

  return normalizePathForCompare(left) === normalizePathForCompare(right);
}

function isSpanInDocument(span, document) {
  if (!hasSpan(span)) {
    return false;
  }

  if (!span.filePath) {
    return true;
  }

  return pathsEqual(span.filePath, document.fileName);
}

function toSpanRange(span) {
  if (!hasSpan(span)) {
    return new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1));
  }

  const startLine = Math.max(0, span.startLine);
  const endLine = Math.max(startLine, span.endLine);
  const startChar = Math.max(0, span.startCharacter);
  const endChar = Math.max(startChar, span.endCharacter);
  return new vscode.Range(new vscode.Position(startLine, startChar), new vscode.Position(endLine, endChar));
}

function locationForSpan(document, span) {
  if (!hasSpan(span)) {
    return null;
  }

  if (!span.filePath || pathsEqual(span.filePath, document.fileName)) {
    return new vscode.Location(document.uri, toRange(document, span));
  }

  if (!isAbsolutePath(span.filePath)) {
    return null;
  }

  return new vscode.Location(vscode.Uri.file(span.filePath), toSpanRange(span));
}

function toRange(document, span) {
  if (!hasSpan(span)) {
    return new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1));
  }

  const startLine = Math.min(Math.max(0, span.startLine), Math.max(0, document.lineCount - 1));
  const endLine = Math.min(Math.max(0, span.endLine), Math.max(0, document.lineCount - 1));
  const startChar = Math.max(0, span.startCharacter);
  const endChar = Math.max(startChar, span.endCharacter);

  const start = new vscode.Position(startLine, startChar);
  const end = new vscode.Position(endLine, endChar);
  return new vscode.Range(start, end);
}

function containsPosition(span, position) {
  if (!hasSpan(span)) {
    return false;
  }

  const line = position.line;
  const character = position.character;
  if (line < span.startLine || line > span.endLine) {
    return false;
  }
  if (line === span.startLine && character < span.startCharacter) {
    return false;
  }
  if (line === span.endLine && character > span.endCharacter) {
    return false;
  }
  return true;
}

function comparePositionToSpanStart(span, position) {
  if (!hasSpan(span)) {
    return 1;
  }
  if (position.line < span.startLine) {
    return -1;
  }
  if (position.line > span.startLine) {
    return 1;
  }
  if (position.character < span.startCharacter) {
    return -1;
  }
  if (position.character > span.startCharacter) {
    return 1;
  }
  return 0;
}

function isCompletionVisible(entry, position, document) {
  if (!entry || entry.isBuiltin || !position) {
    return true;
  }

  if (entry.visibilitySpan) {
    if (document && !isSpanInDocument(entry.visibilitySpan, document)) {
      return false;
    }
    if (!containsPosition(entry.visibilitySpan, position)) {
      return false;
    }
  }

  if (entry.span && document && !isSpanInDocument(entry.span, document)) {
    return false;
  }

  if (entry.span && comparePositionToSpanStart(entry.span, position) < 0) {
    return false;
  }

  return true;
}

function getQualifiedWordRange(document, position) {
  return document.getWordRangeAtPosition(
    position,
    /[A-Za-z_][A-Za-z0-9_]*(?:\.[A-Za-z_][A-Za-z0-9_]*)*/
  );
}

function mapCompletionKind(kind) {
  switch (kind) {
    case "function":
    case "proof":
      return vscode.CompletionItemKind.Function;
    case "variable":
      return vscode.CompletionItemKind.Variable;
    case "type":
    case "trait":
    case "effect":
    case "typeAlias":
      return vscode.CompletionItemKind.Class;
    case "constructor":
      return vscode.CompletionItemKind.Constructor;
    case "field":
      return vscode.CompletionItemKind.Field;
    case "module":
      return vscode.CompletionItemKind.Module;
    case "keyword":
      return vscode.CompletionItemKind.Keyword;
    case "typeParameter":
      return vscode.CompletionItemKind.TypeParameter;
    default:
      return vscode.CompletionItemKind.Text;
  }
}

function mapSymbolKind(kind) {
  switch (kind) {
    case "module":
      return vscode.SymbolKind.Module;
    case "function":
    case "proof":
      return vscode.SymbolKind.Function;
    case "type":
    case "typeAlias":
      return vscode.SymbolKind.Class;
    case "trait":
    case "effect":
      return vscode.SymbolKind.Interface;
    case "constructor":
      return vscode.SymbolKind.Constructor;
    case "field":
      return vscode.SymbolKind.Field;
    case "variable":
      return vscode.SymbolKind.Variable;
    case "constant":
      return vscode.SymbolKind.Constant;
    case "typeParameter":
      return vscode.SymbolKind.TypeParameter;
    default:
      return vscode.SymbolKind.Object;
  }
}

function mapDiagnosticSeverity(level) {
  switch (level) {
    case "warning":
      return vscode.DiagnosticSeverity.Warning;
    case "info":
      return vscode.DiagnosticSeverity.Information;
    case "note":
    case "help":
      return vscode.DiagnosticSeverity.Hint;
    case "error":
    default:
      return vscode.DiagnosticSeverity.Error;
  }
}

function getLocale() {
  const config = vscode.workspace.getConfiguration("eidosc");
  return config.get("locale", "zh-CN");
}

const uiText = {
  en: {
    binding: "binding",
    ffiLibrary: "FFI library",
    labels: "labels",
    fixes: "fixes",
    notes: "notes",
    help: "help",
    label: "label",
    related: "related",
    noBorrowCapabilities: "(none)",
    borrowCapabilities: "Borrow capabilities",
    mode: "mode",
    global: "global",
    providers: "providers"
  },
  "zh-CN": {
    binding: "绑定",
    ffiLibrary: "FFI 库",
    labels: "标签",
    fixes: "修复",
    notes: "说明",
    help: "建议",
    label: "标签",
    related: "相关信息",
    noBorrowCapabilities: "(无)",
    borrowCapabilities: "借用Effect",
    mode: "模式",
    global: "全局Effect",
    providers: "提供者"
  }
};

function tr(locale, key) {
  return uiText[locale]?.[key] || uiText.en[key] || key;
}

function localizeText(text, locale) {
  if (typeof text !== "string") {
    return text ?? "";
  }
  if (locale !== "zh-CN") {
    return text;
  }

  const rules = [
    [/^Style suggestion: prefer fluent syntax for prefix calls\.$/, "风格建议：前缀调用可改为链式调用。"],
    [/^Style suggestion: curried prefix calls can use fluent or grouped-call syntax\.$/, "风格建议：连续柯里化前缀调用可改为链式或分组调用。"],
    [/^prefix call can be rewritten$/, "前缀调用可重写"],
    [/^curried prefix call can be rewritten$/, "连续柯里化前缀调用可重写"],
    [/^Use the quick fix to rewrite the call without changing argument order\.$/, "使用快速修复在不改变参数顺序的前提下重写调用。"],
    [/^Use the quick fix that best matches the local style\.$/, "选择最符合当前代码风格的快速修复。"],
    [/^Rewrite as `(.+)`$/, "改写为 `$1`"],
    [/^View-pattern expression is invalid: (.+)$/, "视图模式左侧表达式无效: $1"],
    [/^view expression$/, "视图表达式"],
    [/^view pattern$/, "视图模式"],
    [/^View expression inferred as: (.+)$/, "视图表达式推断类型: $1"],
    [/^`\(expr -> pattern\)` requires `expr` to be callable as `expr\(scrutinee\)`\.$/, "`(expr -> pattern)` 要求 `expr` 可按 `expr(scrutinee)` 形式调用。"],
    [/^As-pattern inner type mismatch: (.+)$/, "as 模式内层类型不匹配: $1"],
    [/^as-pattern binding$/, "as 模式绑定"],
    [/^as-pattern inner pattern$/, "as 模式内层模式"],
    [/^as-pattern requires the inner pattern type to match the scrutinee type\.$/, "as 模式要求内层模式类型与被匹配值类型一致。"],
    [/^Scrutinee type inferred as: (.+)$/, "被匹配值推断类型: $1"],
    [/^Non-exhaustive pattern matching in (.+); missing constructors: (.+)$/, "$1 中模式匹配不穷尽；缺失构造器: $2"],
    [/^Non-exhaustive pattern matching in (.+); missing bool cases: (.+)$/, "$1 中模式匹配不穷尽；缺失布尔分支: $2"],
    [/^Non-exhaustive pattern matching in (.+); missing list cases: (.+)$/, "$1 中模式匹配不穷尽；缺失列表形状分支: $2"],
    [/^Non-exhaustive pattern matching in (.+); add '_' branch or cover all cases\.$/, "$1 中模式匹配不穷尽；请补充 '_' 分支或覆盖所有情况。"],
    [/^Unreachable pattern branch #(\d+): previous branch #(\d+) is irrefutable and has no guard$/, "不可达模式分支 #$1：前面的分支 #$2 不可反驳且没有 guard"],
    [/^Unreachable pattern branch #(\d+): guard is constant false$/, "不可达模式分支 #$1：guard 恒为 false"],
    [/^pattern coverage$/, "模式覆盖检查"],
    [/^unreachable pattern branch$/, "不可达模式分支"],
    [/^Remove this branch or change its guard condition\.$/, "请移除此分支，或修改其 guard 条件。"],
    [/^Guarded branches are not considered exhaustive by coverage analysis\.$/, "覆盖分析不会将带 guard 的分支视为穷尽。"],
    [/^Guarded branches with unresolved predicates were conservatively excluded from exact coverage: (.+)\.$/, "带有未可判定谓词的 guard 分支已被保守地排除在精确覆盖之外: $1。"],
    [/^Unresolved-guard branch hints: (.+)$/, "不可判定 guard 分支提示: $1"],
    [/^Conservatively suppressed covered warnings: (.+) \(reason: adt-guarded-refutable-view\)$/, "保守抑制的 covered 告警: $1（原因: adt-guarded-refutable-view）"],
    [/^Conservatively suppressed covered warnings: (.+) \(reason: list-guarded-uncertain-view\)$/, "保守抑制的 covered 告警: $1（原因: list-guarded-uncertain-view）"],
    [/^Suppressed-covered trace kv: (.+)$/, "保守抑制 covered 追踪键值: $1"],
    [/^Missing-case traces: (.+)$/, "缺失分支追踪: $1"],
    [/^Missing-case trace groups: (.+)$/, "缺失分支追踪分组: $1"],
    [/^Missing-case trace kv: (.+)$/, "缺失分支追踪键值: $1"],
    [/^Covered-case traces: (.+)$/, "已覆盖样例追踪: $1"],
    [/^Covered-case lower-bound traces: (.+)$/, "已覆盖样例下界追踪: $1"],
    [/^Move this branch earlier or add a guard to the previous irrefutable branch\.$/, "请将该分支前移，或给前一个不可反驳分支添加 guard。"],
    [/^Undefined identifier '(.+)'$/, "未定义的标识符 '$1'"],
    [/^Undefined variable '(.+)'$/, "未定义的变量 '$1'"],
    [/^Undefined type '(.+)'$/, "未定义的类型 '$1'"],
    [/^Undefined trait '(.+)'$/, "未定义的 trait '$1'"],
    [/^Undefined effect '(.+)'$/, "未定义的Effect '$1'"],
    [/^Undefined constructor '(.+)'$/, "未定义的构造器 '$1'"],
    [/^Cannot resolve path '(.+)'$/, "无法解析路径 '$1'"],
    [/^Cannot assign to immutable variable '(.+)'$/, "不能给不可变变量 '$1' 赋值"],
    [/^Cannot resolve eidosc\.dotnetProject\..*$/, "无法解析 eidosc.dotnetProject，请打开仓库目录或设置为绝对路径。"],
    [/^No runnable eidosc backend found\..*$/, "未找到可运行的 eidosc 后端。请安装 eidosc，或配置 dotnetPath + dotnetProject。"],
    [/^Native eidosc not found: '(.+)'.*$/, "未找到 eidosc 可执行文件 '$1'。请安装 eidosc 或配置 eidosc.cliPath。"],
    [/^dotnet not found: '(.+)'.*$/, "未找到 dotnet 可执行文件 '$1'。请安装 .NET SDK 或配置 eidosc.dotnetPath。"],
    [/^Empty JSON output from eidosc ide\.$/, "eidosc ide 未返回内容。"],
    [/^Invalid JSON output: (.+)$/, "eidosc ide 输出不是合法 JSON：$1"],
    [/^Eidosc semantic failed for current file\..*$/, "当前文件语义分析失败，请查看 Output > Eidosc。"],
    [/^FFI external function from library '(.+)'$/, "来自库 '$1' 的 FFI 外部函数"]
  ];

  for (const [pattern, replacement] of rules) {
    if (pattern.test(text)) {
      return text.replace(pattern, replacement);
    }
  }

  return text;
}

function localizeDocumentation(text, locale) {
  if (typeof text !== "string") {
    return text ?? "";
  }
  if (locale !== "zh-CN") {
    return text;
  }

  const exact = new Map([
    ["Builtin signed integer type.", "内置有符号整数类型。"],
    ["Builtin floating-point number type.", "内置浮点数类型。"],
    ["Builtin boolean type with `true`/`false`.", "内置布尔类型，取值为 `true`/`false`。"],
    ["Builtin UTF-8 string type.", "内置 UTF-8 字符串类型。"],
    ["Builtin single character type.", "内置单字符类型。"],
    ["Builtin unit type for expressions with no meaningful value.", "内置 Unit 类型，用于无有效返回值的表达式。"],
    ["Language keyword.", "语言关键字。"],
    ["Trait self type placeholder. Only valid inside trait method signatures.", "Trait 自类型占位符，仅可用于 trait 方法签名。"]
  ]);

  if (exact.has(text)) {
    return exact.get(text);
  }

  const rules = [
    [/^Function `(.+)`\.$/, "函数 `$1`。"],
    [/^Value `(.+)`\.$/, "值 `$1`。"],
    [/^Value `(.+)`: `(.+)`\.$/, "值 `$1`: `$2`。"],
    [/^Pattern-bound value `(.+)` \((.+)\)\.$/, "模式绑定值 `$1`（$2）。"],
    [/^Pattern-bound value `(.+)` \((.+)\): `(.+)`\.$/, "模式绑定值 `$1`（$2）：`$3`。"],
    [/^Type `(.+)`\.$/, "类型 `$1`。"],
    [/^Constructor `(.+)`\.$/, "构造器 `$1`。"],
    [/^Trait `(.+)`\.$/, "Trait `$1`。"],
    [/^Ability `(.+)`\.$/, "Effect `$1`。"],
    [/^Type parameter `(.+)`\.$/, "类型参数 `$1`。"],
    [/^Module `(.+)`\.$/, "模块 `$1`。"],
    [/^Field `(.+)`\.$/, "字段 `$1`。"],
    [/^Trait implementation `(.+)`\.$/, "Trait 实现 `$1`。"]
  ];

  for (const [pattern, replacement] of rules) {
    if (pattern.test(text)) {
      return text.replace(pattern, replacement);
    }
  }

  return text;
}

function localizeKind(kind, locale) {
  if (!kind || locale !== "zh-CN") {
    return kind;
  }

  const map = new Map([
    ["function", "函数"],
    ["variable", "变量"],
    ["type", "类型"],
    ["typeAlias", "类型别名"],
    ["trait", "Trait"],
    ["effect", "Effect"],
    ["module", "模块"],
    ["constructor", "构造器"],
    ["field", "字段"],
    ["proof", "证明"],
    ["keyword", "关键字"],
    ["typeParameter", "类型参数"],
    ["impl", "实现"]
  ]);

  return map.get(kind) ?? kind;
}

function localizeDetail(detail, locale) {
  if (!detail || locale !== "zh-CN") {
    return detail;
  }

  const map = new Map([
    ["function", "函数"],
    ["value", "值"],
    ["mutable variable", "可变变量"],
    ["parameter", "参数"],
    ["pattern binding", "模式绑定"],
    ["type", "类型"],
    ["trait", "Trait"],
    ["effect", "Effect"],
    ["type parameter", "类型参数"],
    ["module", "模块"],
    ["constructor", "构造器"],
    ["field", "字段"],
    ["proof", "证明"],
    ["trait impl", "Trait 实现"],
    ["keyword", "关键字"]
  ]);

  return map.get(detail) ?? detail;
}

function normalizeCapabilityList(capabilities) {
  if (Array.isArray(capabilities)) {
    return capabilities
      .filter((item) => typeof item === "string" && item.length > 0)
      .map((item) => item.toLowerCase());
  }

  if (typeof capabilities === "string" && capabilities.length > 0) {
    return [capabilities.toLowerCase()];
  }

  return [];
}

function findBorrowCapabilityEntry(snapshot, symbol) {
  if (!snapshot || !symbol || typeof symbol.name !== "string") {
    return null;
  }

  if (symbol.kind !== "function" && symbol.detail !== "function") {
    return null;
  }

  const entries = Array.isArray(snapshot.borrowCapabilities)
    ? snapshot.borrowCapabilities
    : [];
  return entries.find((entry) => entry && entry.functionName === symbol.name) ?? null;
}

function buildBorrowCapabilityMarkdown(snapshot, symbol, locale) {
  const entry = findBorrowCapabilityEntry(snapshot, symbol);
  if (!entry) {
    return "";
  }

  const sectionTitle = tr(locale, "borrowCapabilities");
  if (!entry.hasSnapshot) {
    const none = locale === "zh-CN"
      ? "没有可用的签名 ownership contract 快照。"
      : "No signature-derived ownership contract snapshot is available.";
    return `\n\n**${sectionTitle}**  \n${none}`;
  }

  const globals = normalizeCapabilityList(entry.globalCapabilities);
  const globalsLine = globals.length > 0
    ? globals.join(", ")
    : tr(locale, "noBorrowCapabilities");

  const providers = Array.isArray(entry.providers) ? entry.providers : [];
  const providerRows = [];
  for (const provider of providers) {
    const providerName = typeof provider?.provider === "string" && provider.provider.length > 0
      ? provider.provider
      : "?";
    const capabilities = normalizeCapabilityList(provider?.capabilities);
    providerRows.push(`- \`${providerName}\`: ${capabilities.length > 0 ? capabilities.join(", ") : tr(locale, "noBorrowCapabilities")}`);
  }

  const scopeLabel = tr(locale, "mode");
  const globalsLabel = tr(locale, "global");
  const providersLabel = tr(locale, "providers");
  const mode = entry.isEnforced
    ? (locale === "zh-CN" ? "enforced" : "enforced")
    : (locale === "zh-CN" ? "allow-all" : "allow-all");
  const providersBody = providerRows.length > 0
    ? providerRows.join("\n")
    : `- ${tr(locale, "noBorrowCapabilities")}`;

  return [
    "",
    `**${sectionTitle}**`,
    `${scopeLabel}: \`${mode}\``,
    `${globalsLabel}: ${globalsLine}`,
    `${providersLabel}:`,
    providersBody
  ].join("\n");
}

function findProofStateEntry(snapshot, symbol) {
  if (!snapshot || !symbol || symbol.kind !== "proof" || typeof symbol.name !== "string") {
    return null;
  }

  const entries = Array.isArray(snapshot.proofStates)
    ? snapshot.proofStates
    : [];
  return entries.find((entry) => entry && entry.proofName === symbol.name) ?? null;
}

function buildProofStateMarkdown(snapshot, symbol, locale) {
  const entry = findProofStateEntry(snapshot, symbol);
  if (!entry) {
    return "";
  }

  const lines = [
    "",
    `**${locale === "zh-CN" ? "Proof 状态" : "Proof state"}**`,
    `${locale === "zh-CN" ? "检查" : "check"}: \`${entry.checkStatus || "not-run"}\``
  ];

  if (typeof entry.goal === "string" && entry.goal.length > 0) {
    lines.push(`${locale === "zh-CN" ? "目标" : "goal"}:`);
    lines.push(`\`\`\`text\n${entry.goal}\n\`\`\``);
  }

  if (typeof entry.failedGoal === "string" && entry.failedGoal.length > 0) {
    lines.push(`${locale === "zh-CN" ? "当前目标" : "current goal"}:`);
    lines.push(`\`\`\`text\n${entry.failedGoal}\n\`\`\``);
  }

  if (typeof entry.failedTerm === "string" && entry.failedTerm.length > 0) {
    lines.push(`${locale === "zh-CN" ? "尝试的证明项" : "attempted term"}:`);
    lines.push(`\`\`\`text\n${entry.failedTerm}\n\`\`\``);
  }

  return lines.join("\n");
}

function compactWhitespace(text) {
  return String(text ?? "").replace(/\s+/g, " ").trim();
}

function truncateText(text, maxLength) {
  if (typeof text !== "string" || text.length <= maxLength) {
    return text;
  }
  if (maxLength <= 3) {
    return text.slice(0, Math.max(0, maxLength));
  }
  return `${text.slice(0, maxLength - 3)}...`;
}

function diagnosticLabelMessage(document, label, locale) {
  const localized = localizeText(label?.message || tr(locale, "label"), locale);
  if (!hasSpan(label?.span)) {
    return localized;
  }

  const line = (label.span.startLine ?? 0) + 1;
  const character = (label.span.startCharacter ?? 0) + 1;
  let suffix = `@${line}:${character}`;
  if (label.span.filePath && !pathsEqual(label.span.filePath, document.fileName)) {
    suffix = `${label.span.filePath}:${line}:${character}`;
  }
  try {
    if (isSpanInDocument(label.span, document)) {
      const preview = truncateText(compactWhitespace(document.getText(toRange(document, label.span))), 40);
      if (preview) {
        suffix += ` -> \`${preview}\``;
      }
    }
  } catch {
    // Ignore span preview failure and keep location-only context.
  }

  return `${localized} ${suffix}`;
}

function diagnosticSection(title, items) {
  if (!Array.isArray(items) || items.length === 0) {
    return "";
  }
  return `${title}:\n  - ${items.join("\n  - ")}`;
}

function rangesIntersect(left, right) {
  if (!left || !right) {
    return false;
  }

  return left.intersection(right) !== undefined;
}

function fullDocumentRange(document) {
  const lastLineIndex = Math.max(0, document.lineCount - 1);
  const lastLine = document.lineAt(lastLineIndex);
  return new vscode.Range(new vscode.Position(0, 0), lastLine.range.end);
}

const semanticTokenTypes = [
  "module",
  "type",
  "class",
  "interface",
  "typeParameter",
  "function",
  "method",
  "proof",
  "property",
  "variable",
  "parameter",
  "patternVariable",
  "fieldLabel",
  "keyword",
  "operator",
  "effect",
  "constructor"
];

const semanticTokenModifiers = [
  "declaration",
  "builtin",
  "mutable",
  "effect",
  "unused",
  "borrowed",
  "mutableBorrow"
];
const lexicalSemanticKeywords = new Set([
  "func", "fn", "let", "mut", "effect", "effects", "trait", "instance", "given", "comptime", "decide", "type", "proof", "forall", "True", "False", "refl", "trivial", "intro", "constructor", "congr", "ext", "first", "second", "left", "right", "contradiction", "exists", "and", "or", "not", "iff", "rewrite", "simp", "todo_proof", "apply", "exact", "symm", "trans", "have", "calc", "at", "by",
  "cases", "induction", "module", "import", "export", "need", "if", "then", "else", "while",
  "match", "when", "return", "loop", "break", "continue", "as",
  "ref", "mref", "link", "internal", "Self"
]);
const lexicalSemanticOperators = [
  ">>>", "<<<", ">>=", "??", "<$>", "<*>", "->", "=>", ":=", "<>", "<=", ">=", "<-", "::",
  "+:", ":+", ".{", "..", "++", "==", "!=", "&&", "||", "|>", "+=", "-=", "*=", "/=", "%=",
  "+", "-", "*", "/", "%", "=", "!", "<", ">", "?", "&", "|"
];

function createStaticEidosCompletions(locale, range) {
  const decide = new vscode.CompletionItem("decide", vscode.CompletionItemKind.Snippet);
  decide.detail = locale === "zh"
    ? "decision table expression"
    : "decision table expression";
  decide.documentation = new vscode.MarkdownString(locale === "zh"
    ? "按源码顺序测试同一 predicate/template 的参数表；未命中时返回 fallback。"
    : "Tests a predicate/template argument table in source order and returns the fallback when no row matches.");
  decide.insertText = new vscode.SnippetString("decide ${1:fallback} {\n\t${2:predicate}(_):\n\t\t${3:key} => ${4:result}\n}");
  decide.sortText = "0_decide";
  if (range) {
    decide.range = range;
  }

  return [decide];
}

function semanticTokenTypeForSymbol(symbol, occurrence) {
  switch (symbol?.kind) {
    case "module":
      return "module";
    case "type":
    case "typeAlias":
      return "type";
    case "trait":
      return "interface";
    case "effect":
      return "effect";
    case "constructor":
      return "constructor";
    case "field":
      return "property";
    case "function":
      return "function";
    case "proof":
      return "proof";
    case "variable":
      if (symbol.detail === "pattern binding") {
        return "patternVariable";
      }
      if (symbol.detail === "parameter" ||
          (symbol.detail === "pattern binding" && occurrence?.role === "definition")) {
        return "parameter";
      }
      return "variable";
    case "typeParameter":
      return "typeParameter";
    default:
      return null;
  }
}

function semanticTokenModifiersForSymbol(symbol, occurrence, unusedSymbolIds = new Set()) {
  const modifiers = [];
  if (occurrence?.role === "definition") {
    modifiers.push("declaration");
  }
  if (symbol?.isBuiltin) {
    modifiers.push("builtin");
  }
  if (symbol?.detail === "mutable variable") {
    modifiers.push("mutable");
  }
  if (symbol?.bindingMode === "ref") {
    modifiers.push("borrowed");
  }
  if (symbol?.bindingMode === "mref") {
    modifiers.push("mutableBorrow");
  }
  if (occurrence?.source === "EffectfulType" || occurrence?.source === "AbilityRequirementNode") {
    modifiers.push("effect");
  }
  if (occurrence?.role === "definition" && unusedSymbolIds.has(symbol?.symbolId)) {
    modifiers.push("unused");
  }
  return modifiers;
}

function findUnusedSymbolIds(snapshot, document, symbolMap) {
  const unused = new Set();
  for (const symbol of symbolMap.values()) {
    if (symbol?.kind === "variable" && symbol.name && symbol.name !== "_") {
      unused.add(symbol.symbolId);
    }
  }

  for (const occurrence of snapshot?.occurrences ?? []) {
    if (!unused.has(occurrence.symbolId) || !hasSpan(occurrence.span) || !isSpanInDocument(occurrence.span, document)) {
      continue;
    }
    if (occurrence.role === "reference") {
      unused.delete(occurrence.symbolId);
    }
  }

  return unused;
}

function pushServerSemanticTokens(builder, snapshot, document, seen) {
  const symbolMap = new Map((snapshot?.symbols ?? []).map((symbol) => [symbol.symbolId, symbol]));
  const unusedSymbolIds = findUnusedSymbolIds(snapshot, document, symbolMap);
  for (const occurrence of snapshot?.occurrences ?? []) {
    if (!hasSpan(occurrence.span) ||
        !isSpanInDocument(occurrence.span, document) ||
        occurrence.span.startLine !== occurrence.span.endLine ||
        occurrence.span.length <= 0) {
      continue;
    }

    const symbol = symbolMap.get(occurrence.symbolId);
    const tokenType = semanticTokenTypeForSymbol(symbol, occurrence);
    if (!tokenType) {
      continue;
    }

    pushTokenIfNew(
      builder,
      seen,
      occurrence.span.startLine,
      occurrence.span.startCharacter,
      occurrence.span.length,
      tokenType,
      semanticTokenModifiersForSymbol(symbol, occurrence, unusedSymbolIds)
    );
  }
}

function trivialDocumentationForSymbol(symbol) {
  if (!symbol?.documentation || !symbol?.name) {
    return false;
  }

  return [
    `Function \`${symbol.name}\`.`,
    `Value \`${symbol.name}\`.`,
    `Type \`${symbol.name}\`.`,
    `Constructor \`${symbol.name}\`.`,
    `Trait \`${symbol.name}\`.`,
    `Ability \`${symbol.name}\`.`,
    `Proof \`${symbol.name}\`.`,
    `Type parameter \`${symbol.name}\`.`,
    `Module \`${symbol.name}\`.`,
    `Field \`${symbol.name}\`.`,
    `Trait implementation \`${symbol.name}\`.`
  ].includes(symbol.documentation);
}

function isSyntheticModulePath(symbol) {
  return symbol?.kind === "module" &&
    symbol?.detail === "module path" &&
    !hasSpan(symbol?.span);
}

function hasCleanTypeText(symbol) {
  return Boolean(symbol?.typeText && symbol?.typeConfidence === "TypedClean");
}

function isTypedCleanSnapshot(snapshot) {
  return snapshot?.snapshotConfidence === "TypedClean";
}

function buildHoverHeader(symbol, locale) {
  switch (symbol.kind) {
    case "function":
      return hasCleanTypeText(symbol) ? `func ${symbol.name}: ${symbol.typeText}` : `func ${symbol.name}`;
    case "variable":
    case "field":
      return hasCleanTypeText(symbol) ? `${symbol.name}: ${symbol.typeText}` : symbol.name;
    case "type":
    case "typeAlias":
      return `type ${symbol.name}`;
    case "trait":
      return `trait ${symbol.name}`;
    case "effect":
      return `effect ${symbol.name}`;
    case "proof":
      return `proof ${symbol.name}`;
    case "module":
      return `module ${symbol.name}`;
    default:
      return hasCleanTypeText(symbol) ? `${symbol.name}: ${symbol.typeText}` : symbol.name;
  }
}

function appendCompactHoverMarkdown(markdown, symbol, locale, snapshot) {
  const header = buildHoverHeader(symbol, locale);
  if (header) {
    markdown.appendCodeblock(header, "eidos");
  }

  const metadata = [];
  const detail = localizeDetail(symbol.detail || "", locale);
  const kind = localizeKind(symbol.kind || "", locale);
  if (detail && detail !== kind && !isSyntheticModulePath(symbol)) {
    metadata.push(detail);
  }
  if (symbol.bindingMode && symbol.bindingMode !== "value") {
    metadata.push(`${tr(locale, "binding")}: \`${symbol.bindingMode}\``);
  }
  if (symbol.externalLibrary) {
    metadata.push(`${tr(locale, "ffiLibrary")}: \`${symbol.externalLibrary}\``);
  }
  if (metadata.length > 0) {
    markdown.appendMarkdown(metadata.join("  \n"));
  }
  if (symbol.documentation && !isSyntheticModulePath(symbol) && !trivialDocumentationForSymbol(symbol)) {
    markdown.appendMarkdown(`\n\n${localizeDocumentation(symbol.documentation, locale)}`);
  }
  const proofState = buildProofStateMarkdown(snapshot, symbol, locale);
  if (proofState) {
    markdown.appendMarkdown(proofState);
  }
}

function collectVariableTypeInlayHints(snapshot, document) {
  const config = vscode.workspace.getConfiguration("eidosc");
  if (!config.get("inlayHints.enabled", true) || !config.get("inlayHints.variableTypes", true)) {
    return [];
  }

  const symbolMap = new Map((snapshot?.symbols ?? []).map((symbol) => [symbol.symbolId, symbol]));
  const hints = [];
  const seen = new Set();
  for (const occurrence of snapshot?.occurrences ?? []) {
    if (occurrence?.role !== "definition" ||
        occurrence?.source !== "LetDecl" ||
        !hasSpan(occurrence.span) ||
        !isSpanInDocument(occurrence.span, document) ||
        occurrence.span.startLine !== occurrence.span.endLine) {
      continue;
    }

    const symbol = symbolMap.get(occurrence.symbolId);
    if (!symbol ||
        symbol.kind !== "variable" ||
        !hasCleanTypeText(symbol) ||
        symbol.detail === "parameter" ||
        symbol.detail === "pattern binding") {
      continue;
    }

    const location = findLetDeclarationName(document, occurrence.span, symbol.name);
    if (!location || location.hasExplicitType) {
      continue;
    }

    const key = `${location.line}:${location.endCharacter}:${symbol.typeText}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);

    const hint = new vscode.InlayHint(
      new vscode.Position(location.line, location.endCharacter),
      `: ${symbol.typeText}`,
      vscode.InlayHintKind.Type
    );
    hint.paddingLeft = false;
    hint.paddingRight = true;
    hints.push(hint);
  }

  return hints;
}

function findLetDeclarationName(document, span, symbolName) {
  if (!hasSpan(span) || span.startLine < 0 || span.startLine >= document.lineCount) {
    return null;
  }

  const lineText = document.lineAt(span.startLine).text;
  const searchStart = Math.max(0, Math.min(span.startCharacter, lineText.length));
  const declarationPattern = /\b(?:let\??)(?:\s+mut)?\s+([A-Za-z_][A-Za-z0-9_]*)/g;
  declarationPattern.lastIndex = searchStart;
  const match = declarationPattern.exec(lineText);
  if (!match || match[1] !== symbolName) {
    return null;
  }

  const startCharacter = match.index + match[0].lastIndexOf(match[1]);
  const endCharacter = startCharacter + match[1].length;
  const equalsIndex = lineText.indexOf("=", endCharacter);
  const annotationSlice = equalsIndex >= 0
    ? lineText.slice(endCharacter, equalsIndex)
    : lineText.slice(endCharacter);

  return {
    line: span.startLine,
    startCharacter,
    endCharacter,
    hasExplicitType: annotationSlice.includes(":")
  };
}

function resolveSymbolInSnapshot(snapshot, document, position) {
  if (!snapshot) {
    return null;
  }

  let best = null;
  for (const occurrence of snapshot.occurrences ?? []) {
    if (!isSpanInDocument(occurrence.span, document)) {
      continue;
    }

    if (!containsPosition(occurrence.span, position)) {
      continue;
    }

    if (!best || occurrence.span.length < best.span.length) {
      best = occurrence;
    }
  }

  if (!best) {
    const wordRange = getQualifiedWordRange(document, position);
    if (!wordRange) {
      return { snapshot, occurrence: null, symbol: null };
    }

    const word = document.getText(wordRange);
    const byCompletion = (snapshot.completions ?? []).find((item) => item.label === word && isCompletionVisible(item, position, document));
    return {
      snapshot,
      occurrence: null,
      symbol: byCompletion
        ? {
            symbolId: null,
            name: byCompletion.label,
            kind: byCompletion.kind,
            detail: byCompletion.detail,
            documentation: byCompletion.documentation,
            typeText: byCompletion.typeText,
            bindingMode: byCompletion.bindingMode,
            span: byCompletion.span,
            visibilitySpan: byCompletion.visibilitySpan,
            isBuiltin: byCompletion.isBuiltin,
          }
        : null
    };
  }

  const symbol = (snapshot.symbols ?? []).find((item) => item.symbolId === best.symbolId) ?? null;
  return { snapshot, occurrence: best, symbol };
}

function pushLexicalSemanticTokens(builder, document, seen) {
  const text = document.getText();
  let line = 0;
  let character = 0;
  for (let i = 0; i < text.length;) {
    const current = text[i];
    const next = i + 1 < text.length ? text[i + 1] : "";

    if (current === "\r" || current === "\n") {
      const advanced = advanceNewLine(text, i);
      i = advanced.index;
      line += 1;
      character = 0;
      continue;
    }

    if (current === "/" && next === "/") {
      i += 2;
      character += 2;
      while (i < text.length && text[i] !== "\r" && text[i] !== "\n") {
        i += 1;
        character += 1;
      }
      continue;
    }

    if (current === "/" && next === "*") {
      i += 2;
      character += 2;
      while (i < text.length) {
        if (text[i] === "\r" || text[i] === "\n") {
          const advanced = advanceNewLine(text, i);
          i = advanced.index;
          line += 1;
          character = 0;
          continue;
        }
        if (text[i] === "*" && i + 1 < text.length && text[i + 1] === "/") {
          i += 2;
          character += 2;
          break;
        }
        i += 1;
        character += 1;
      }
      continue;
    }

    if ((current === "r" || current === "f") && next === "\"") {
      i += 1;
      character += 1;
      const skipped = skipQuoted(text, i, line, character, "\"");
      i = skipped.index;
      line = skipped.line;
      character = skipped.character;
      continue;
    }

    if (current === "\"" || current === "'") {
      const skipped = skipQuoted(text, i, line, character, current);
      i = skipped.index;
      line = skipped.line;
      character = skipped.character;
      continue;
    }

    if (/[A-Za-z_]/.test(current)) {
      const qualifiedPrefixLength = pushQualifiedModulePrefixTokens(builder, seen, text, i, line, character);
      if (qualifiedPrefixLength > 0) {
        i += qualifiedPrefixLength;
        character += qualifiedPrefixLength;
        continue;
      }

      const start = i;
      const startCharacter = character;
      i += 1;
      character += 1;
      while (i < text.length && /[A-Za-z0-9_]/.test(text[i])) {
        i += 1;
        character += 1;
      }
      const word = text.slice(start, i);
      if (start > 0 && text[start - 1] === "." && /^[a-z_]/.test(word) && nextNonWhitespaceIs(text, i, "(")) {
        pushTokenIfNew(builder, seen, line, startCharacter, word.length, "function", []);
      }
      if (isRecordFieldLabel(text, start, i)) {
        pushTokenIfNew(builder, seen, line, startCharacter, word.length, "fieldLabel", []);
      }
      if (lexicalSemanticKeywords.has(word)) {
        pushTokenIfNew(builder, seen, line, startCharacter, word.length, "keyword", []);
      }
      continue;
    }

    const op = lexicalSemanticOperators.find((candidate) => text.startsWith(candidate, i));
    if (op) {
      pushTokenIfNew(builder, seen, line, character, op.length, "operator", []);
      i += op.length;
      character += op.length;
      continue;
    }

    i += 1;
    character += 1;
  }
}

function pushQualifiedModulePrefixTokens(builder, seen, text, start, line, character) {
  const segments = [];
  const segmentStarts = [];
  let cursor = start;
  let cursorCharacter = character;
  const firstLength = readIdentifierLength(text, cursor);
  if (firstLength <= 0) {
    return 0;
  }

  segments.push({ character: cursorCharacter, length: firstLength });
  segmentStarts.push(cursor);
  cursor += firstLength;
  cursorCharacter += firstLength;

  while (cursor < text.length && text[cursor] === ".") {
    const segmentLength = readIdentifierLength(text, cursor + 1);
    if (segmentLength <= 0) {
      break;
    }

    cursor += 1;
    cursorCharacter += 1;
    segmentStarts.push(cursor);
    segments.push({ character: cursorCharacter, length: segmentLength });
    cursor += segmentLength;
    cursorCharacter += segmentLength;
  }

  if (segments.length < 2 ||
      !(/[A-Z]/.test(text[segmentStarts[0]])) && !(/[A-Z]/.test(text[segmentStarts[1]]))) {
    return 0;
  }

  for (const segment of segments.slice(0, -1)) {
    pushTokenIfNew(builder, seen, line, segment.character, segment.length, "module", []);
  }

  const leaf = segments[segments.length - 1];
  if (/[a-z_]/.test(text[segmentStarts[segmentStarts.length - 1]]) && nextNonWhitespaceIs(text, cursor, "(")) {
    pushTokenIfNew(builder, seen, line, leaf.character, leaf.length, "function", []);
  }

  return cursor - start;
}

function isRecordFieldLabel(text, start, end) {
  if (end >= text.length || text[end] !== ":" || text[end + 1] === ":") {
    return false;
  }

  const previous = previousNonWhitespaceChar(text, start - 1);
  return previous === "{" || previous === ",";
}

function previousNonWhitespaceChar(text, index) {
  for (let cursor = index; cursor >= 0; cursor -= 1) {
    if (!/\s/.test(text[cursor])) {
      return text[cursor];
    }
  }
  return "";
}

function readIdentifierLength(text, start) {
  if (start >= text.length || !/[A-Za-z_]/.test(text[start])) {
    return 0;
  }

  let cursor = start + 1;
  while (cursor < text.length && /[A-Za-z0-9_]/.test(text[cursor])) {
    cursor += 1;
  }

  return cursor - start;
}

function pushTokenIfNew(builder, seen, line, character, length, tokenType, modifiers) {
  const key = `${line}:${character}:${length}`;
  if (seen.has(key)) {
    return;
  }
  seen.add(key);
  builder.push(line, character, length, tokenType, modifiers);
}

function nextNonWhitespaceIs(text, index, expected) {
  while (index < text.length && /\s/.test(text[index])) {
    index += 1;
  }
  return index < text.length && text[index] === expected;
}

function advanceNewLine(text, index) {
  if (text[index] === "\r" && index + 1 < text.length && text[index + 1] === "\n") {
    return { index: index + 2 };
  }
  return { index: index + 1 };
}

function skipQuoted(text, index, line, character, quote) {
  index += 1;
  character += 1;
  while (index < text.length) {
    const current = text[index];
    if (current === "\r" || current === "\n") {
      const advanced = advanceNewLine(text, index);
      index = advanced.index;
      line += 1;
      character = 0;
      continue;
    }
    if (current === "\\" && index + 1 < text.length) {
      index += 2;
      character += 2;
      continue;
    }
    index += 1;
    character += 1;
    if (current === quote) {
      break;
    }
  }
  return { index, line, character };
}

function activate(context) {
  extensionRoot = context.extensionPath;
  const output = vscode.window.createOutputChannel("Eidosc");
  const diagnostics = vscode.languages.createDiagnosticCollection("eidosc");
  const inlayHintsChanged = new vscode.EventEmitter();
  const eidosSelector = [
    { language: "eidos", scheme: "file" },
    { language: "eidos", scheme: "untitled" },
    { pattern: "**/*.eidos", scheme: "file" },
    { pattern: "**/*.eidos", scheme: "untitled" }
  ];
  const manifestSelector = [
    { language: "eidos-manifest", scheme: "file" },
    { pattern: "**/eidos.toml", scheme: "file" }
  ];
  const completionSelector = [...eidosSelector, ...manifestSelector];
  const snapshots = new Map();
  const pendingRefresh = new Map();
  const semanticJobs = new Map();
  const warnedDocs = new Set();
  const semanticFailures = new Set();
  const lspClient = new EidosLspClient(output, diagnostics);

  function findGeneratedDocumentInSnapshots(uri) {
    for (const state of snapshots.values()) {
      for (const snapshot of [state?.snapshot, state?.lastGoodSnapshot]) {
        const generated = (snapshot?.generatedDocuments ?? []).find((document) => document.uri === uri);
        if (generated?.content) {
          return generated.content;
        }
      }
    }
    return null;
  }

  const generatedDocumentProvider = vscode.workspace.registerTextDocumentContentProvider(
    "eidos-generated",
    {
      provideTextDocumentContent: async (uri) => {
        const uriText = uri.toString();
        const sourceDocument = vscode.window.activeTextEditor?.document;
        try {
          const generated = await lspClient.generatedDocument(
            uriText,
            isEidosSourceDocument(sourceDocument) ? sourceDocument : null
          );
          if (generated?.content) {
            return generated.content;
          }
        } catch (error) {
          output.appendLine(`[eidosc][lsp][generatedDocument] ${error.message}`);
        }

        return findGeneratedDocumentInSnapshots(uriText) ??
          `// Generated Eidos declaration is not available in the current semantic snapshot.\n// ${uriText}\n`;
      }
    }
  );

  function useLspDiagnostics() {
    const config = vscode.workspace.getConfiguration("eidosc");
    return config.get("semanticEnabled", true) && config.get("semanticBackend", "lsp") === "lsp";
  }

  function useLspSemanticBackend() {
    return useLspDiagnostics() && lspClient.isAvailable();
  }

  function scheduleSemanticDiagnostics(document) {
    if (useLspSemanticBackend() && isEidosSourceDocument(document)) {
      lspClient.syncDocument(document).then((synced) => {
        if (!synced) {
          scheduleSnapshot(document);
        }
      }).catch((error) => {
        output.appendLine(`[eidosc][lsp] ${error.message}`);
        lspClient.markFailure(error);
        scheduleSnapshot(document);
      });
      return;
    }

    scheduleSnapshot(document);
  }

  function lastGoodSnapshotFor(document) {
    return snapshots.get(document.uri.toString())?.lastGoodSnapshot ?? null;
  }

  function currentSnapshotFor(document) {
    const current = snapshots.get(document.uri.toString());
    return current && current.version === document.version ? current.snapshot : null;
  }

  function bestAvailableSnapshotFor(document) {
    return currentSnapshotFor(document) ?? lastGoodSnapshotFor(document);
  }

  function semanticJobFor(key) {
    let job = semanticJobs.get(key);
    if (!job) {
      job = {
        task: null,
        cancellation: null,
        requestedVersion: null
      };
      semanticJobs.set(key, job);
    }
    return job;
  }

  async function fetchSnapshot(document) {
    if (isManifestDocument(document)) {
      return null;
    }

    const config = vscode.workspace.getConfiguration("eidosc");
    if (!config.get("semanticEnabled", true)) {
      diagnostics.delete(document.uri);
      return null;
    }

    const key = document.uri.toString();
    const current = snapshots.get(key);
    if (current && current.version === document.version) {
      return current.snapshot;
    }

    const job = semanticJobFor(key);
    if (job.task) {
      if (job.requestedVersion === document.version) {
        return await job.task;
      }
      job.cancellation?.cancel();
    }

    const cancellation = createCancellationSource();
    const task = (async () => {
      const requestedVersion = document.version;
      const built = buildIdeCommand(document.fileName);
      if (built.error) {
        throw new Error(built.error);
      }
      const { command, args, cwd } = built;
      const result = await spawnProcess(command, args, cwd, document.getText(), cancellation.token);
      if (result.cancelled) {
        return bestAvailableSnapshotFor(document);
      }
      if (result.error) {
        throw result.error;
      }

      if ((result.code ?? 1) !== 0 && !result.stdout.trim()) {
        throw new Error(result.stderr || `eidosc ide failed with exit ${result.code}`);
      }

      const snapshot = parseJsonFromOutput(result.stdout);
      if (document.isClosed) {
        return snapshot;
      }

      if (document.version !== requestedVersion) {
        scheduleSnapshot(document);
        return snapshot;
      }

      const previous = snapshots.get(key);
      snapshots.set(key, {
        version: requestedVersion,
        snapshot,
        lastGoodSnapshot: snapshot?.success ? snapshot : previous?.lastGoodSnapshot ?? null
      });

      if (result.stderr && result.stderr.trim() && !warnedDocs.has(key)) {
        warnedDocs.add(key);
        output.appendLine(`[eidosc][ide][stderr] ${result.stderr.trim()}`);
      }

      if (!useLspDiagnostics()) {
        applyDiagnostics(document, snapshot);
      }
      inlayHintsChanged.fire();
      semanticFailures.delete(key);
      return snapshot;
    })();

    job.task = task;
    job.cancellation = cancellation;
    job.requestedVersion = document.version;
    try {
      return await task;
    } finally {
      if (job.task === task) {
        job.task = null;
        job.cancellation = null;
        job.requestedVersion = null;
      }
    }
  }

  function fetchSnapshotInBackground(document) {
    fetchSnapshot(document).catch((error) => {
      const locale = getLocale();
      const key = document.uri.toString();
      const localizedError = localizeText(error.message, locale);
      const message = `[eidosc][ide] ${localizedError}`;
      output.appendLine(message);
      if (!semanticFailures.has(key)) {
        semanticFailures.add(key);
      }
    });
  }

  async function fetchSnapshotForInteractiveUse(document) {
    const snapshot = bestAvailableSnapshotFor(document);
    if (snapshot) {
      if (!currentSnapshotFor(document)) {
        fetchSnapshotInBackground(document);
      }
      return snapshot;
    }

    return await fetchSnapshot(document);
  }

  function applyDiagnostics(document, snapshot) {
    const locale = getLocale();
    const items = [];
    const entries = snapshot?.diagnostics ?? [];
    for (const entry of entries) {
      if (hasSpan(entry.span) && !isSpanInDocument(entry.span, document)) {
        continue;
      }

      const range = hasSpan(entry.span)
        ? toRange(document, entry.span)
        : new vscode.Range(new vscode.Position(0, 0), new vscode.Position(0, 1));
      const mainMessage = localizeText(entry.message || "diagnostic", locale);
      const notes = entry.notes?.map((note) => localizeText(note, locale)) ?? [];
      const related = [];
      const labels = [];
      if (entry.labels?.length) {
        labels.push(
          ...entry.labels
            .map((label) => diagnosticLabelMessage(document, label, locale))
            .filter((label) => label && label.trim().length > 0)
        );

        for (const label of entry.labels) {
          if (!hasSpan(label?.span) || !isSpanInDocument(label.span, document)) {
            continue;
          }
          const rangeForLabel = toRange(document, label.span);
          const relatedMessage = localizeText(label?.message || tr(locale, "label"), locale);
          related.push(new vscode.DiagnosticRelatedInformation(
            new vscode.Location(document.uri, rangeForLabel),
            relatedMessage
          ));
        }
      }
      if (entry.related?.length) {
        for (const relatedEntry of entry.related) {
          if (!hasSpan(relatedEntry?.span)) {
            continue;
          }
          const location = locationForSpan(document, relatedEntry.span);
          if (!location) {
            continue;
          }
          related.push(new vscode.DiagnosticRelatedInformation(
            location,
            localizeText(relatedEntry.message || tr(locale, "related"), locale)
          ));
        }
      }
      const suggestions = entry.suggestions?.map((suggestion) => localizeText(suggestion?.message || "", locale)).filter((item) => item && item.trim().length > 0) ?? [];
      const helps = entry.helps?.map((help) => localizeText(help, locale)) ?? [];
      const messageParts = [
        mainMessage,
        diagnosticSection(tr(locale, "labels"), labels),
        diagnosticSection(tr(locale, "fixes"), suggestions),
        diagnosticSection(tr(locale, "notes"), notes),
        diagnosticSection(tr(locale, "help"), helps)
      ].filter((part) => part && part.trim().length > 0);

      const diagnostic = new vscode.Diagnostic(range, messageParts.join("\n"), mapDiagnosticSeverity(entry.severity));
      diagnostic.source = "eidosc";
      if (entry.code) {
        diagnostic.code = entry.code;
      }
      if (related.length > 0) {
        diagnostic.relatedInformation = related;
      }
      items.push(diagnostic);
    }
    diagnostics.set(document.uri, items);
  }

  function scheduleSnapshot(document) {
    if (!document) {
      return;
    }

    if (isManifestDocument(document)) {
      diagnostics.set(document.uri, validateManifestDocument(document, getLocale()));
      return;
    }

    if (!isEidosSourceDocument(document)) {
      return;
    }

    const config = vscode.workspace.getConfiguration("eidosc");
    const locale = getLocale();
    const delay = Math.max(50, config.get("semanticDebounceMs", 180));
    const key = document.uri.toString();
    if (pendingRefresh.has(key)) {
      clearTimeout(pendingRefresh.get(key));
    }

    pendingRefresh.set(key, setTimeout(async () => {
      pendingRefresh.delete(key);
      try {
        await fetchSnapshot(document);
      } catch (error) {
        const localizedError = localizeText(error.message, locale);
        const message = `[eidosc][ide] ${localizedError}`;
        output.appendLine(message);
        if (!semanticFailures.has(key)) {
          semanticFailures.add(key);
          const tip = locale === "zh-CN"
            ? `当前文件语义分析失败，请查看 Output > Eidosc。\n${localizedError}`
            : `Eidosc semantic failed for current file. See Output > Eidosc.\n${localizedError}`;
          vscode.window.showWarningMessage(tip);
        }
      }
    }, delay));
  }

  async function resolveSymbolAt(document, position) {
    const snapshot = await fetchSnapshotForInteractiveUse(document);
    const resolved = resolveSymbolInSnapshot(snapshot, document, position);
    const fallbackSnapshot = lastGoodSnapshotFor(document);
    if (!fallbackSnapshot || fallbackSnapshot === snapshot) {
      return resolved;
    }

    if (hasCleanTypeText(resolved?.symbol) || snapshot?.success) {
      return resolved;
    }

    const fallback = resolveSymbolInSnapshot(fallbackSnapshot, document, position);
    if (!resolved?.symbol) {
      return fallback ? { ...fallback, stale: true } : resolved;
    }

    if (fallback?.symbol?.name === resolved.symbol.name && hasCleanTypeText(fallback.symbol)) {
      return {
        snapshot: resolved.snapshot,
        occurrence: resolved.occurrence,
        stale: true,
        symbol: {
          ...resolved.symbol,
          typeText: fallback.symbol.typeText,
          typeConfidence: fallback.symbol.typeConfidence
        }
      };
    }

    return resolved;
  }

  function runEidoscCommand(label, built, successMessage, failureMessage) {
    const locale = getLocale();
    if (built.error) {
      const localized = localizeText(built.error, locale);
      output.appendLine(`[eidosc] ${localized}`);
      output.show(true);
      vscode.window.showErrorMessage(`${failureMessage}: ${localized}`);
      return;
    }

    const { command, args, cwd } = built;
    output.clear();
    output.appendLine(`[eidosc] ${label}`);
    output.appendLine(`[eidosc] cwd: ${cwd}`);
    output.appendLine(`[eidosc] cmd: ${command} ${args.join(" ")}`);
    output.show(true);

    const child = cp.spawn(command, args, { cwd, shell: false });
    child.stdout.on("data", (data) => output.append(data.toString()));
    child.stderr.on("data", (data) => output.append(data.toString()));
    child.on("error", (error) => {
      output.appendLine(`[eidosc] failed: ${error.message}`);
      vscode.window.showErrorMessage(`${failureMessage}: ${localizeText(error.message, locale)}`);
    });
    child.on("close", (code) => {
      if (code === 0) {
        vscode.window.showInformationMessage(successMessage);
      } else {
        vscode.window.showErrorMessage(`${failureMessage} (${locale === "zh-CN" ? "退出码" : "exit"} ${code}).`);
      }
    });
  }

  function buildCommandForActiveTarget(command) {
    const document = getActiveEidosDocument();
    const target = getCommandTarget(document);
    const args = buildProjectArgs(command, target);
    const cwd = target.projectRoot || target.workspace;
    return buildCliCommand(target.filePath, args, cwd);
  }

  function buildPackageCommand(subcommand) {
    const document = getActiveEidosDocument();
    const target = getCommandTarget(document);
    const cwd = target.projectRoot || target.workspace;
    return buildCliCommand(target.filePath, buildPackageArgs(subcommand), cwd);
  }

  const disposable = vscode.commands.registerCommand("eidosc.analyzeCurrentFile", () => {
    const locale = getLocale();
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
      vscode.window.showWarningMessage(locale === "zh-CN" ? "当前没有活动编辑器。" : "No active editor.");
      return;
    }

    const doc = editor.document;
    if (doc.languageId !== "eidos" && !doc.fileName.endsWith(".eidos")) {
      vscode.window.showWarningMessage(locale === "zh-CN" ? "当前文件不是 .eidos 文件。" : "Active file is not an .eidos file.");
      return;
    }

    if (doc.isDirty) {
      doc.save();
    }

    const filePath = doc.fileName;
    const built = buildCommand(filePath);
    if (built.error) {
      const localized = localizeText(built.error, locale);
      output.appendLine(`[eidosc] ${localized}`);
      output.show(true);
      vscode.window.showErrorMessage(locale === "zh-CN" ? `Eidosc 分析失败：${localized}` : `Eidosc analyze failed: ${localized}`);
      return;
    }

    const { command, args, cwd } = built;

    output.clear();
    output.appendLine(`[eidosc] cwd: ${cwd}`);
    output.appendLine(`[eidosc] cmd: ${command} ${args.join(" ")}`);
    output.show(true);

    const child = cp.spawn(command, args, { cwd, shell: false });
    child.stdout.on("data", (data) => output.append(data.toString()));
    child.stderr.on("data", (data) => output.append(data.toString()));
    child.on("error", (error) => {
      output.appendLine(`[eidosc] failed: ${error.message}`);
      const localized = localizeText(error.message, locale);
      vscode.window.showErrorMessage(locale === "zh-CN" ? `Eidosc 命令执行失败：${localized}` : `Eidosc command failed: ${localized}`);
    });
    child.on("close", (code) => {
      if (code === 0) {
        vscode.window.showInformationMessage(locale === "zh-CN" ? "Eidosc 分析完成。" : "Eidosc analyze completed.");
      } else {
        vscode.window.showErrorMessage(locale === "zh-CN" ? `Eidosc 分析失败（退出码 ${code}）。` : `Eidosc analyze failed (exit ${code}).`);
      }
    });
  });

  const formatCommand = vscode.commands.registerCommand("eidosc.formatDocument", async () => {
    await vscode.commands.executeCommand("editor.action.formatDocument");
  });

  const buildProjectCommand = vscode.commands.registerCommand("eidosc.buildProject", () => {
    const locale = getLocale();
    runEidoscCommand(
      "build",
      buildCommandForActiveTarget("build"),
      locale === "zh-CN" ? "Eidosc 构建完成。" : "Eidosc build completed.",
      locale === "zh-CN" ? "Eidosc 构建失败" : "Eidosc build failed"
    );
  });

  const runProjectCommand = vscode.commands.registerCommand("eidosc.runProject", () => {
    const locale = getLocale();
    runEidoscCommand(
      "run",
      buildCommandForActiveTarget("run"),
      locale === "zh-CN" ? "Eidosc 运行完成。" : "Eidosc run completed.",
      locale === "zh-CN" ? "Eidosc 运行失败" : "Eidosc run failed"
    );
  });

  const pkgInstallCommand = vscode.commands.registerCommand("eidosc.pkgInstall", () => {
    const locale = getLocale();
    runEidoscCommand(
      "pkg install",
      buildPackageCommand("install"),
      locale === "zh-CN" ? "Eidosc 包安装完成。" : "Eidosc package install completed.",
      locale === "zh-CN" ? "Eidosc 包安装失败" : "Eidosc package install failed"
    );
  });

  const pkgListCommand = vscode.commands.registerCommand("eidosc.pkgList", () => {
    const locale = getLocale();
    runEidoscCommand(
      "pkg list",
      buildPackageCommand("list"),
      locale === "zh-CN" ? "Eidosc 包列表已刷新。" : "Eidosc package list completed.",
      locale === "zh-CN" ? "Eidosc 包列表失败" : "Eidosc package list failed"
    );
  });

  const pkgTreeCommand = vscode.commands.registerCommand("eidosc.pkgTree", () => {
    const locale = getLocale();
    runEidoscCommand(
      "pkg tree",
      buildPackageCommand("tree"),
      locale === "zh-CN" ? "Eidosc 依赖树已输出。" : "Eidosc package tree completed.",
      locale === "zh-CN" ? "Eidosc 依赖树失败" : "Eidosc package tree failed"
    );
  });

  const formattingProvider = vscode.languages.registerDocumentFormattingEditProvider(
    eidosSelector,
    {
      async provideDocumentFormattingEdits(document, options) {
        const config = vscode.workspace.getConfiguration("eidosc");
        if (!config.get("format.enabled", true)) {
          return [];
        }

        const locale = getLocale();
        const built = buildFormatCommand(document.fileName, options);
        if (built.error) {
          const localized = localizeText(built.error, locale);
          output.appendLine(`[eidosc][fmt] ${localized}`);
          vscode.window.showErrorMessage(locale === "zh-CN" ? `Eidosc 格式化失败：${localized}` : `Eidosc format failed: ${localized}`);
          return [];
        }

        const { command, args, cwd } = built;
        const result = await spawnProcess(command, args, cwd, document.getText());
        if (result.error) {
          const localized = localizeText(result.error.message, locale);
          output.appendLine(`[eidosc][fmt] ${localized}`);
          vscode.window.showErrorMessage(locale === "zh-CN" ? `Eidosc 格式化失败：${localized}` : `Eidosc format failed: ${localized}`);
          return [];
        }

        if ((result.code ?? 1) !== 0) {
          const message = result.stderr?.trim() || `eidosc fmt failed with exit ${result.code}`;
          const localized = localizeText(message, locale);
          output.appendLine(`[eidosc][fmt] ${localized}`);
          vscode.window.showErrorMessage(locale === "zh-CN" ? `Eidosc 格式化失败：${localized}` : `Eidosc format failed: ${localized}`);
          return [];
        }

        if (!result.stdout || result.stdout === document.getText()) {
          return [];
        }

        return [
          vscode.TextEdit.replace(fullDocumentRange(document), result.stdout)
        ];
      }
    }
  );

  const completionProvider = vscode.languages.registerCompletionItemProvider(
    completionSelector,
    {
      async provideCompletionItems(document, position) {
        const locale = getLocale();
        if (isManifestDocument(document)) {
          return getManifestCompletionItems(document, position, locale);
        }

        const completionRange = getQualifiedWordRange(document, position);
        if (useLspSemanticBackend()) {
          try {
            const result = await lspClient.completion(document, position);
            const semanticItems = (Array.isArray(result) ? result : result?.items ?? [])
              .map(lspCompletionItemToVsCode);
            const staticItems = createStaticEidosCompletions(locale, completionRange)
              .filter((item) => !semanticItems.some((semanticItem) => semanticItem.label === item.label));
            return [...staticItems, ...semanticItems];
          } catch (error) {
            output.appendLine(`[eidosc][lsp][completion] ${error.message}`);
            lspClient.markFailure(error);
          }
        }

        const snapshot = await fetchSnapshotForInteractiveUse(document);
        if (!snapshot) {
          return [];
        }

        const semanticItems = (snapshot.completions ?? [])
          .filter((entry) => isCompletionVisible(entry, position, document))
          .map((entry) => {
          const item = new vscode.CompletionItem(entry.label, mapCompletionKind(entry.kind));
          const detailParts = [];
          const localizedDetail = localizeDetail(entry.detail || "", locale);
          if (localizedDetail) {
            detailParts.push(localizedDetail);
          }
          if (entry.bindingMode) {
            detailParts.push(`binding=${entry.bindingMode}`);
          }
          if (hasCleanTypeText(entry)) {
            detailParts.push(`type=${entry.typeText}`);
          }
          item.detail = detailParts.join(" | ");
          item.sortText = entry.sortText || entry.label;
          if (completionRange) {
            item.range = completionRange;
          }
          item.insertText = entry.label;
          const doc = localizeDocumentation(entry.documentation, locale);
          item.documentation = doc ? new vscode.MarkdownString(doc) : undefined;
          return item;
        });
        const staticItems = createStaticEidosCompletions(locale, completionRange)
          .filter((item) => !semanticItems.some((semanticItem) => semanticItem.label === item.label));
        return [...staticItems, ...semanticItems];
      }
    }
  );

  const definitionProvider = vscode.languages.registerDefinitionProvider(
    eidosSelector,
    {
      async provideDefinition(document, position) {
        if (useLspSemanticBackend()) {
          try {
            const location = lspLocationToVsCode(await lspClient.definition(document, position));
            return location;
          } catch (error) {
            output.appendLine(`[eidosc][lsp][definition] ${error.message}`);
            lspClient.markFailure(error);
          }
        }

        const resolved = await resolveSymbolAt(document, position);
        if (!resolved || !resolved.symbol) {
          return null;
        }
        if (hasSpan(resolved.symbol.span)) {
          return locationForSpan(document, resolved.symbol.span);
        }
        if (isSyntheticModulePath(resolved.symbol) && hasSpan(resolved.occurrence?.span)) {
          return locationForSpan(document, resolved.occurrence.span);
        }
        return null;
      }
    }
  );

  const referencesProvider = vscode.languages.registerReferenceProvider(
    eidosSelector,
    {
      async provideReferences(document, position, contextRef) {
        if (useLspSemanticBackend()) {
          try {
            const locations = await lspClient.references(document, position, contextRef?.includeDeclaration);
            const mapped = (locations ?? [])
              .map(lspLocationToVsCode)
              .filter(Boolean);
            if (!contextRef?.includeDeclaration) {
              return mapped;
            }
            return mapped;
          } catch (error) {
            output.appendLine(`[eidosc][lsp][references] ${error.message}`);
            lspClient.markFailure(error);
          }
        }

        const resolved = await resolveSymbolAt(document, position);
        if (!resolved || !resolved.snapshot || !resolved.occurrence) {
          return [];
        }

        const symbolId = resolved.occurrence.symbolId;
        const unique = new Set();
        const refs = [];
        for (const occurrence of resolved.snapshot.occurrences ?? []) {
          if (occurrence.symbolId !== symbolId) {
            continue;
          }
          if (!contextRef.includeDeclaration && occurrence.role === "definition") {
            continue;
          }
          if (!hasSpan(occurrence.span)) {
            continue;
          }

          const location = locationForSpan(document, occurrence.span);
          if (!location) {
            continue;
          }

          const key = `${occurrence.span.filePath || document.fileName}:${occurrence.span.start}:${occurrence.span.length}:${occurrence.role}`;
          if (unique.has(key)) {
            continue;
          }
          unique.add(key);
          refs.push(location);
        }
        return refs;
      }
    }
  );

  const documentSymbolProvider = vscode.languages.registerDocumentSymbolProvider(
    eidosSelector,
    {
      async provideDocumentSymbols(document) {
        if (useLspSemanticBackend()) {
          try {
            const symbols = await lspClient.documentSymbols(document);
            return (symbols ?? []).map(lspDocumentSymbolToVsCode);
          } catch (error) {
            output.appendLine(`[eidosc][lsp][documentSymbol] ${error.message}`);
            lspClient.markFailure(error);
          }
        }

        const snapshot = await fetchSnapshotForInteractiveUse(document);
        return (snapshot?.outline ?? [])
          .filter((entry) => hasSpan(entry.span) && isSpanInDocument(entry.span, document))
          .map((entry) => {
            const range = toRange(document, entry.span);
            return new vscode.DocumentSymbol(
              entry.name || "",
              entry.detail || "",
              mapSymbolKind(entry.kind),
              range,
              range
            );
          });
      }
    }
  );

  const codeActionProvider = vscode.languages.registerCodeActionsProvider(
    eidosSelector,
    {
      async provideCodeActions(document, range, context) {
        const locale = getLocale();
        const targetRange = range instanceof vscode.Range
          ? range
          : new vscode.Range(range.start, range.end);

        if (useLspSemanticBackend()) {
          try {
            const actions = await lspClient.codeActions(document, targetRange, context);
            return (actions ?? []).map((action) => lspCodeActionToVsCode(action, context?.diagnostics));
          } catch (error) {
            output.appendLine(`[eidosc][lsp][codeAction] ${error.message}`);
            lspClient.markFailure(error);
          }
        }

        const snapshot = await fetchSnapshot(document);
        if (!snapshot) {
          return [];
        }

        const actions = [];

        for (const entry of snapshot.diagnostics ?? []) {
          if (!entry?.suggestions?.length) {
            continue;
          }
          if (hasSpan(entry.span) && !isSpanInDocument(entry.span, document)) {
            continue;
          }

          const diagnosticRange = hasSpan(entry.span)
            ? toRange(document, entry.span)
            : null;
          if (diagnosticRange && !rangesIntersect(diagnosticRange, targetRange)) {
            continue;
          }

          for (const suggestion of entry.suggestions) {
            if (!suggestion?.replacement || !hasSpan(suggestion.span) || !isSpanInDocument(suggestion.span, document)) {
              continue;
            }
            if (suggestion.requiresCleanTypes && !isTypedCleanSnapshot(snapshot)) {
              continue;
            }

            const action = new vscode.CodeAction(
              localizeText(suggestion.message || (locale === "zh-CN" ? "应用建议" : "Apply suggestion"), locale),
              vscode.CodeActionKind.QuickFix
            );
            const edit = new vscode.WorkspaceEdit();
            edit.replace(document.uri, toRange(document, suggestion.span), suggestion.replacement);
            action.edit = edit;
            action.isPreferred = String(suggestion.kind || "").toLowerCase() === "addimport";
            if (context?.diagnostics?.length) {
              action.diagnostics = context.diagnostics;
            }
            actions.push(action);
          }
        }

        return actions;
      }
    },
    { providedCodeActionKinds: [vscode.CodeActionKind.QuickFix] }
  );

  const semanticTokensLegend = new vscode.SemanticTokensLegend(semanticTokenTypes, semanticTokenModifiers);
  const semanticTokensProvider = vscode.languages.registerDocumentSemanticTokensProvider(
    eidosSelector,
    {
      async provideDocumentSemanticTokens(document) {
        const config = vscode.workspace.getConfiguration("eidosc");
        if (!config.get("semanticHighlighting", true)) {
          return new vscode.SemanticTokensBuilder(semanticTokensLegend).build();
        }

        if (useLspSemanticBackend()) {
          try {
            const tokens = await lspClient.semanticTokens(document);
            return new vscode.SemanticTokens(remapLspSemanticTokenData(tokens?.data));
          } catch (error) {
            output.appendLine(`[eidosc][lsp][semanticTokens] ${error.message}`);
            lspClient.markFailure(error);
          }
        }

        const snapshot = await fetchSnapshotForInteractiveUse(document);
        const builder = new vscode.SemanticTokensBuilder(semanticTokensLegend);
        const seen = new Set();
        pushServerSemanticTokens(builder, snapshot, document, seen);
        if (!snapshot?.success) {
          pushLexicalSemanticTokens(builder, document, seen);
        }
        return builder.build();
      }
    },
    semanticTokensLegend
  );

  const hoverProvider = vscode.languages.registerHoverProvider(
    completionSelector,
    {
      async provideHover(document, position) {
        const locale = getLocale();
        if (isManifestDocument(document)) {
          const manifestKey = getManifestHoverKey(document, position);
          const markdown = manifestKey ? createManifestMarkdown(manifestKey, locale) : null;
          return markdown ? new vscode.Hover(markdown) : null;
        }

        if (useLspSemanticBackend()) {
          try {
            return lspHoverToVsCode(await lspClient.hover(document, position));
          } catch (error) {
            output.appendLine(`[eidosc][lsp][hover] ${error.message}`);
            lspClient.markFailure(error);
          }
        }

        const resolved = await resolveSymbolAt(document, position);
        if (!resolved || !resolved.symbol) {
          return null;
        }

        const symbol = resolved.symbol;
        const markdown = new vscode.MarkdownString();
        appendCompactHoverMarkdown(markdown, symbol, locale, resolved.snapshot);
        const borrowCapability = buildBorrowCapabilityMarkdown(resolved.snapshot, symbol, locale);
        if (borrowCapability) {
          markdown.appendMarkdown(borrowCapability);
        }
        if (resolved.stale) {
          markdown.appendMarkdown(locale === "zh-CN"
            ? "\n\n> 过期信息：此悬浮内容来自上一次成功的 Eidos 语义快照，当前文档可能已有错误或尚未完成分析。"
            : "\n\n> Stale information: this hover uses the last successful Eidos semantic snapshot; the current document may contain errors or unfinished analysis.");
        }
        return new vscode.Hover(markdown);
      }
    }
  );

  const inlayHintsProvider = vscode.languages.registerInlayHintsProvider(
    eidosSelector,
    {
      onDidChangeInlayHints: inlayHintsChanged.event,
      async provideInlayHints(document, range, token) {
        if (useLspSemanticBackend()) {
          try {
            const hints = await lspClient.inlayHints(document, range);
            if (token?.isCancellationRequested) {
              return [];
            }
            return (hints ?? []).map(lspInlayHintToVsCode).filter(Boolean);
          } catch (error) {
            output.appendLine(`[eidosc][lsp][inlayHint] ${error.message}`);
            lspClient.markFailure(error);
          }
        }

        const snapshot = await fetchSnapshotForInteractiveUse(document);
        if (!snapshot || token?.isCancellationRequested) {
          return [];
        }

        const hints = collectVariableTypeInlayHints(snapshot, document);
        if (!snapshot.success) {
          const fallbackSnapshot = lastGoodSnapshotFor(document);
          if (fallbackSnapshot && fallbackSnapshot !== snapshot) {
            const seen = new Set(hints.map((hint) => `${hint.position.line}:${hint.position.character}:${hint.label}`));
            for (const hint of collectVariableTypeInlayHints(fallbackSnapshot, document)) {
              const key = `${hint.position.line}:${hint.position.character}:${hint.label}`;
              if (!seen.has(key)) {
                seen.add(key);
                hint.tooltip = "Stale inferred type from the last successful Eidos snapshot.";
                hints.push(hint);
              }
            }
          }
        }

        return hints.filter((hint) => range.contains(hint.position));
      }
    }
  );

  const buildStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 80);
  buildStatus.text = "$(tools) Eidos Build";
  buildStatus.command = "eidosc.buildProject";
  buildStatus.tooltip = "Build the active Eidos project or file";

  const runStatus = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 79);
  runStatus.text = "$(play) Eidos Run";
  runStatus.command = "eidosc.runProject";
  runStatus.tooltip = "Run the active Eidos executable target";

  function updateStatusButtons(editor) {
    const document = editor?.document;
    const visible = !!document && isProjectAwareDocument(document);
    if (visible) {
      buildStatus.show();
      runStatus.show();
    } else {
      buildStatus.hide();
      runStatus.hide();
    }
  }

  const onOpen = vscode.workspace.onDidOpenTextDocument((document) => scheduleSemanticDiagnostics(document));
  const onChange = vscode.workspace.onDidChangeTextDocument((event) => scheduleSemanticDiagnostics(event.document));
  const onSave = vscode.workspace.onDidSaveTextDocument((document) => scheduleSemanticDiagnostics(document));
  const onActiveEditor = vscode.window.onDidChangeActiveTextEditor((editor) => {
    if (editor?.document) {
      scheduleSemanticDiagnostics(editor.document);
    }
    updateStatusButtons(editor);
  });
  const onConfig = vscode.workspace.onDidChangeConfiguration((event) => {
    if (!event.affectsConfiguration("eidosc")) {
      return;
    }

    commandProbeCache.clear();
    dotnetProjectCache.clear();
    lspClient.stop();
    diagnostics.clear();
    const editor = vscode.window.activeTextEditor;
    if (editor?.document) {
      scheduleSemanticDiagnostics(editor.document);
    }
  });
  const onClose = vscode.workspace.onDidCloseTextDocument((document) => {
    const key = document.uri.toString();
    if (pendingRefresh.has(key)) {
      clearTimeout(pendingRefresh.get(key));
      pendingRefresh.delete(key);
    }
    snapshots.delete(key);
    const job = semanticJobs.get(key);
    job?.cancellation?.cancel();
    semanticJobs.delete(key);
    warnedDocs.delete(key);
    semanticFailures.delete(key);
    lspClient.didClose(document);
    diagnostics.delete(document.uri);
  });

  vscode.workspace.textDocuments.forEach((document) => scheduleSemanticDiagnostics(document));
  updateStatusButtons(vscode.window.activeTextEditor);

  context.subscriptions.push(
    disposable,
    formatCommand,
    buildProjectCommand,
    runProjectCommand,
    pkgInstallCommand,
    pkgListCommand,
    pkgTreeCommand,
    output,
    { dispose: () => lspClient.dispose() },
    generatedDocumentProvider,
    diagnostics,
    formattingProvider,
    completionProvider,
    definitionProvider,
    referencesProvider,
    documentSymbolProvider,
    codeActionProvider,
    semanticTokensProvider,
    inlayHintsProvider,
    inlayHintsChanged,
    hoverProvider,
    buildStatus,
    runStatus,
    onOpen,
    onChange,
    onSave,
    onActiveEditor,
    onConfig,
    onClose
  );
}

function deactivate() {}

module.exports = {
  activate,
  deactivate
};
