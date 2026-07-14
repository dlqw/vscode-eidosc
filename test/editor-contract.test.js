const assert = require("assert");
const fs = require("fs");
const path = require("path");

const root = path.resolve(__dirname, "..");
const compatibility = JSON.parse(fs.readFileSync(path.join(root, "compatibility.json"), "utf8"));
const manifest = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
assert.strictEqual(compatibility.version, manifest.version, "compatibility metadata must match package version");
assert.deepStrictEqual(compatibility.manifestSchemas, [3]);
assert.strictEqual(compatibility.language, ">=0.5.0-alpha.1 <0.6.0");
assert.strictEqual(compatibility.eidosc, ">=0.5.0-alpha.1 <0.6.0");
const grammar = JSON.parse(fs.readFileSync(path.join(root, "syntaxes", "eidos.tmLanguage.json"), "utf8"));
const manifestGrammar = JSON.parse(fs.readFileSync(path.join(root, "syntaxes", "eidos-manifest.tmLanguage.json"), "utf8"));
const extension = fs.readFileSync(path.join(root, "out", "extension.js"), "utf8");
const readme = fs.readFileSync(path.join(root, "README.md"), "utf8");
const themes = manifest.contributes.themes ?? [];

const commands = new Set(manifest.contributes.commands.map((command) => command.command));
for (const expected of [
  "eidosc.analyzeCurrentFile",
  "eidosc.formatDocument",
  "eidosc.buildProject",
  "eidosc.runProject",
  "eidosc.pkgInstall",
  "eidosc.pkgList",
  "eidosc.pkgTree"
]) {
  assert(commands.has(expected), `missing command contribution: ${expected}`);
}

for (const expected of [
  "eidosc.semanticBackend",
  "eidosc.semanticHighlighting",
  "eidosc.inlayHints.enabled",
  "eidosc.inlayHints.variableTypes",
  "eidosc.package.targetName",
  "eidosc.run.args"
]) {
  assert(
    Object.hasOwn(manifest.contributes.configuration.properties, expected),
    `missing configuration: ${expected}`
  );
}

assert(
  manifest.contributes.languages?.some((language) => language.id === "eidos-manifest" && language.filenames?.includes("eidos.toml")),
  "extension should contribute the eidos.toml manifest language"
);
assert(
  manifest.contributes.grammars?.some((entry) => entry.language === "eidos-manifest" && entry.path === "./syntaxes/eidos-manifest.tmLanguage.json"),
  "extension should contribute a dedicated eidos.toml grammar"
);
assert(
  manifest.contributes.semanticTokenScopes?.[0]?.scopes?.module?.includes("entity.name.module.eidos"),
  "module semantic token should have a TextMate fallback scope"
);
assert(
  manifest.contributes.semanticTokenScopes?.[0]?.scopes?.fieldLabel?.includes("variable.other.member.field.eidos"),
  "fieldLabel semantic token should have a TextMate fallback scope"
);
assert(
  manifest.contributes.configuration.properties["eidosc.semanticBackend"]?.enum?.includes("lsp") &&
    manifest.contributes.configuration.properties["eidosc.semanticBackend"]?.default === "lsp",
  "extension should default semantic providers to the LSP backend"
);
assert(
  manifest.contributes.semanticTokenScopes?.[0]?.scopes?.patternVariable?.includes("variable.other.pattern.eidos"),
  "patternVariable semantic token should have a TextMate fallback scope"
);
assert(
  manifest.contributes.semanticTokenScopes?.[0]?.scopes?.proof?.includes("entity.name.function.proof.eidos"),
  "proof semantic token should have a TextMate fallback scope"
);
assert(
  manifest.contributes.semanticTokenScopes?.[0]?.scopes?.effectTag?.includes("entity.name.type.effect.eidos"),
  "effect semantic token should have a TextMate fallback scope"
);
assert(
  manifest.contributes.semanticTokenTypes?.some((token) => token.id === "proof"),
  "proof semantic token type should be contributed"
);
assert(
  manifest.contributes.semanticTokenModifiers?.some((modifier) => modifier.id === "borrowed"),
  "borrowed semantic token modifier should be contributed"
);
assert(
  manifest.contributes.semanticTokenModifiers?.some((modifier) => modifier.id === "mutableBorrow"),
  "mutableBorrow semantic token modifier should be contributed"
);
assert(
  manifest.contributes.semanticTokenScopes?.[0]?.scopes?.constructor?.includes("entity.name.type.eidos"),
  "constructor semantic token should have a TextMate fallback scope"
);
assert(
  !Object.hasOwn(manifest.contributes.semanticTokenScopes?.[0]?.scopes ?? {}, "namespace"),
  "Eidos should not contribute namespace semantic token fallback scopes"
);
assert(
  manifest.contributes.semanticTokenScopes?.[0]?.scopes?.parameter?.includes("variable.parameter.eidos"),
  "parameter semantic token should have a TextMate fallback scope"
);
assert(
  manifest.contributes.semanticTokenScopes?.[0]?.scopes?.variable?.includes("variable.other.eidos"),
  "variable semantic token should have a TextMate fallback scope"
);
assert(
  extension.includes('registerTextDocumentContentProvider(\n    "eidos-generated"') &&
    extension.includes('this.request("eidos/generatedDocument", { uri })'),
  "extension should resolve generated definition URIs through the Eidos LSP virtual document request"
);
assert(readme.includes("eidos-generated://") && readme.includes("eidos/generatedDocument"));

assert(themes.length >= 3, "extension should contribute Eidos-focused color themes");
for (const expected of [
  "Eidos Axiom Dark",
  "Eidos Proof Light",
  "Eidos Contrast Dark"
]) {
  const theme = themes.find((item) => item.label === expected);
  assert(theme, `missing Eidos theme: ${expected}`);
  assert(theme.path, `theme should have a path: ${expected}`);

  const themePath = path.join(root, theme.path);
  assert(fs.existsSync(themePath), `theme file should exist: ${theme.path}`);
  const themeJson = JSON.parse(fs.readFileSync(themePath, "utf8"));
  assert.strictEqual(themeJson.semanticHighlighting, true, `${expected} should enable semantic highlighting`);
  assert(themeJson.semanticTokenColors?.module, `${expected} should color Eidos modules`);
  assert(!Object.hasOwn(themeJson.semanticTokenColors ?? {}, "namespace"), `${expected} should not color namespace tokens`);
  assert(themeJson.semanticTokenColors?.fieldLabel, `${expected} should color record field labels`);
  assert(themeJson.semanticTokenColors?.patternVariable, `${expected} should color pattern variables`);
  assert(themeJson.semanticTokenColors?.proof, `${expected} should color proofs`);
  assert(themeJson.semanticTokenColors?.effectTag, `${expected} should color effects`);
  assert(themeJson.semanticTokenColors?.constructor, `${expected} should color constructors`);
  assert(themeJson.semanticTokenColors?.["*.effect"], `${expected} should color effect constraints`);
  assert(themeJson.semanticTokenColors?.["*.unused"], `${expected} should color unused declarations`);
  assert(themeJson.semanticTokenColors?.["*.borrowed"], `${expected} should color shared borrow bindings`);
  assert(themeJson.semanticTokenColors?.["*.mutableBorrow"], `${expected} should color mutable borrow bindings`);
  assert(
    JSON.stringify(themeJson.tokenColors ?? []).includes("entity.name.module.eidos"),
    `${expected} should color TextMate module scopes`
  );
  assert(
    JSON.stringify(themeJson.tokenColors ?? []).includes("variable.other.member.field.eidos"),
    `${expected} should color TextMate record field labels`
  );
  assert(
    JSON.stringify(themeJson.tokenColors ?? []).includes("entity.name.function.proof.eidos"),
    `${expected} should color TextMate proof declarations`
  );
}

assert(
  manifestGrammar.patterns.some((pattern) => pattern.include === "#tables"),
  "manifest grammar should include table highlighting"
);
assert(
  manifestGrammar.patterns.some((pattern) => pattern.include === "#keys"),
  "manifest grammar should include key highlighting"
);
assert(
  JSON.stringify(manifestGrammar.repository.tables).includes("targets"),
  "manifest grammar should highlight [[targets]] tables"
);
assert(
  JSON.stringify(manifestGrammar.repository.keys).includes("meta.key-value.eidos-manifest"),
  "manifest grammar should scope manifest key-value pairs"
);
assert(
  grammar.patterns.some((pattern) => pattern.include === "#declarations"),
  "grammar should include declaration highlighting"
);
assert(
  grammar.patterns.some((pattern) => pattern.include === "#calls"),
  "grammar should include call highlighting"
);
assert(
  grammar.patterns.some((pattern) => pattern.include === "#qualified"),
  "grammar should include qualified path prefix highlighting"
);
assert(
  grammar.patterns.some((pattern) => pattern.include === "#members"),
  "grammar should include member highlighting"
);
assert(
  grammar.patterns.some((pattern) => pattern.include === "#patterns"),
  "grammar should include pattern highlighting"
);
assert(
  grammar.repository.declarations.patterns.some((pattern) =>
    JSON.stringify(pattern).includes("entity.name.function.eidos")),
  "grammar should scope function declarations"
);
assert(
  grammar.repository.declarations.patterns.some((pattern) =>
    pattern.name === "meta.function.definition.name-first.eidos" &&
    pattern.match.includes("::") &&
    pattern.match.includes("comptime")),
  "grammar should scope 0.5.0-alpha.1 name-first function declarations"
);
assert(
  grammar.repository.declarations.patterns.some((pattern) =>
    pattern.name === "meta.module.definition.name-first.eidos" &&
    JSON.stringify(pattern).includes("entity.name.module.eidos")),
  "grammar should scope 0.5.0-alpha.1 name-first module declarations"
);
for (const expected of [
  "meta.type.definition.name-first.eidos",
  "meta.trait.definition.name-first.eidos",
  "meta.effect.definition.name-first.eidos",
  "meta.instance.definition.name-first.eidos",
  "meta.import.binding.name-first.eidos",
  "meta.comptime.definition.name-first.eidos",
  "meta.value.definition.name-first.eidos"
]) {
  assert(
    grammar.repository.declarations.patterns.some((pattern) => pattern.name === expected),
    `grammar should scope ${expected}`
  );
}
assert(
  grammar.repository.declarations.patterns.some((pattern) =>
    pattern.name === "meta.generic.parameter.value.eidos" &&
    pattern.match.includes("comptime") &&
    JSON.stringify(pattern).includes("variable.parameter.comptime.eidos")),
  "grammar should provide a lexical fallback for value-level const generic parameters"
);
for (const expected of [
  "meta.type.definition.name-first.eidos",
  "meta.trait.definition.name-first.eidos",
  "meta.effect.definition.name-first.eidos",
  "meta.instance.definition.name-first.eidos",
  "meta.function.definition.name-first.eidos"
]) {
  const pattern = grammar.repository.declarations.patterns.find((item) => item.name === expected);
  assert(pattern?.match.includes("[^\\]\\n]"), `${expected} should accept generic parameter lists before ::`);
}
assert(
  grammar.repository.declarations.patterns.some((pattern) =>
    pattern.name === "meta.value.definition.eidos" &&
    pattern.match.includes("let\\??")),
  "grammar should scope let? bindings as value declarations"
);
assert(
  grammar.repository.declarations.patterns.some((pattern) =>
    JSON.stringify(pattern).includes("entity.name.function.proof.eidos")),
  "grammar should scope proof declarations"
);
assert(
  grammar.repository.declarations.patterns.some((pattern) =>
    pattern.name === "meta.proof.definition.eidos" &&
    pattern.match.includes("[A-Z][A-Za-z0-9_]*")),
  "grammar should require upper-case proof declaration names"
);
assert(JSON.stringify(grammar.repository.keywords).includes("congr"), "grammar should highlight congr proof keyword");
assert(JSON.stringify(grammar.repository.keywords).includes("ext"), "grammar should highlight ext proof keyword");
assert(JSON.stringify(grammar.repository.keywords).includes("type"), "grammar should highlight type keyword");
assert(JSON.stringify(grammar.repository.keywords).includes("effect"), "grammar should highlight effect keyword");
assert(JSON.stringify(grammar.repository.keywords).includes("instance"), "grammar should highlight instance keyword");
assert(JSON.stringify(grammar.repository.keywords).includes("given"), "grammar should highlight given keyword");
assert(JSON.stringify(grammar.repository.keywords).includes("comptime"), "grammar should highlight comptime keyword");
assert(JSON.stringify(grammar.repository.keywords).includes("decide"), "grammar should highlight decide keyword");
assert(JSON.stringify(grammar.repository.types).includes("Self"), "grammar should highlight Self type");
assert(JSON.stringify(grammar.repository.types).includes("Seq"), "grammar should highlight Seq type");
assert(JSON.stringify(grammar.repository.types).includes("CInt"), "grammar should highlight C ABI integer types");
assert(JSON.stringify(grammar.repository.types).includes("MutCPtr"), "grammar should highlight mutable C pointer types");
assert(JSON.stringify(grammar.repository.types).includes("CStr"), "grammar should highlight C string type");
assert(
  grammar.repository.attributes.patterns.some((pattern) =>
    pattern.match.includes("derive") &&
    pattern.match.includes("impl") &&
    pattern.match.includes("ffi") &&
    pattern.match.includes("borrow") &&
    pattern.match.includes("operator") &&
    pattern.match.includes("proof_unfold") &&
    pattern.match.includes("internal") &&
    pattern.match.includes("transparent")),
  "grammar should highlight current Eidos attributes"
);
assert(
  grammar.repository.attributes.patterns.some((pattern) => pattern.match.includes("@[A-Za-z_]")),
  "grammar should highlight generic attributes such as @derive"
);
assert(
  grammar.repository.operators.patterns.some((pattern) => pattern.match.includes("|[+\\-*/%]=?|=|")),
  "grammar should highlight constructor-associated constant initializer ="
);
assert(
  grammar.repository.operators.patterns.some((pattern) => pattern.match.includes("\\+:") && pattern.match.includes(":\\+")),
  "grammar should highlight list prepend (+:) and append (:+) operators"
);
assert(extension.includes("\"congr\""), "lexical semantic keywords should include congr");
assert(extension.includes("\"ext\""), "lexical semantic keywords should include ext");
assert(extension.includes("\"effect\""), "lexical semantic keywords should include effect keyword");
assert(extension.includes("\"instance\""), "lexical semantic keywords should include instance");
assert(extension.includes("\"given\""), "lexical semantic keywords should include given");
assert(extension.includes("\"comptime\""), "lexical semantic keywords should include comptime");
assert(extension.includes('const manifestLanguageVersions = ["0.5.0-alpha.1"]'), "manifest completion should target Eidos 0.5.0-alpha.1");
assert(extension.includes("\"decide\""), "lexical semantic keywords should include decide");
assert(extension.includes("createStaticEidosCompletions"), "extension should provide static Eidos completions");
assert(extension.includes("new vscode.SnippetString(\"decide"), "extension should provide decide snippet completion");
assert(extension.includes("\"??\""), "lexical semantic operators should include Option fallback");
assert(extension.includes("\"+:\"") && extension.includes("\":+\""), "lexical semantic operators should include Seq cons operators");
assert(extension.includes("let\\??)(?:\\s+mut)?"), "inlay hint declaration matching should include let and let?");
assert(
  extension.includes("/[A-Za-z_][A-Za-z0-9_]*(?:(?:[/.]|::)[A-Za-z_][A-Za-z0-9_]*)*/"),
  "qualified word range should include dot-separated module paths"
);
assert(
  extension.includes("const projectRoot = findProjectRoot(filePath);") &&
    extension.includes("\"--project\", projectRoot"),
  "semantic IDE command should pass the nearest eidos.toml project root"
);
assert(
  extension.includes("config.get(\"package.targetName\", \"\")") &&
    extension.includes("\"--target-name\", configuredTargetName"),
  "semantic IDE command should pass configured target name with project context"
);
assert(
  grammar.repository.declarations.patterns.some((pattern) =>
    JSON.stringify(pattern).includes("entity.name.type.effect.eidos")),
  "grammar should scope effect declarations"
);
assert(
  grammar.repository.qualified.patterns.some((pattern) =>
    pattern.name === "entity.name.module.eidos" && pattern.match.includes("(?=::)")),
  "grammar should scope qualified path prefixes before ::"
);
assert(
  grammar.repository.declarations.patterns.some((pattern) =>
    JSON.stringify(pattern).includes("\\b(import)") &&
    JSON.stringify(pattern).includes("entity.name.package.eidos") &&
    JSON.stringify(pattern).includes("entity.name.module.eidos") &&
    JSON.stringify(pattern).includes("\\\\.")),
  "grammar should scope package-qualified dot-separated imports"
);
assert(
  grammar.repository.declarations.patterns.some((pattern) =>
    JSON.stringify(pattern).includes("\\b(import)") &&
    JSON.stringify(pattern).includes("entity.name.package.eidos") &&
    JSON.stringify(pattern).includes("entity.name.module.eidos") &&
    JSON.stringify(pattern).includes("/")),
  "grammar should scope package-qualified imports"
);
assert(
  grammar.repository.qualified.patterns.some((pattern) =>
    pattern.name === "entity.name.module.eidos" && pattern.match.includes("(?:\\.")),
  "grammar should scope dot-separated module prefixes before ::"
);
assert(
  grammar.repository.qualified.patterns.some((pattern) =>
    pattern.name === "entity.name.module.eidos" && pattern.match.includes("(?:/")),
  "grammar should scope slash-separated module prefixes before ::"
);
assert(
  grammar.repository.qualified.patterns.some((pattern) =>
    pattern.name === "entity.name.module.eidos" && pattern.match.includes("(?<=/)")),
  "grammar should scope slash-separated module segments independently"
);
assert(
  grammar.repository.operators.patterns.some((pattern) => pattern.match.includes("\\.\\{")),
  "grammar should highlight short record update operator"
);
assert(
  grammar.repository.members.patterns.some((pattern) =>
    pattern.name === "entity.name.function.call.eidos" && pattern.match.includes("(?<=\\.)")),
  "grammar should scope function calls after dot access"
);
assert(
  grammar.repository.members.patterns.some((pattern) =>
    pattern.name === "meta.record.field-label.eidos" &&
    JSON.stringify(pattern).includes("variable.other.member.field.eidos")),
  "grammar should scope record field labels without treating every colon as a field"
);
assert(
  grammar.repository.members.patterns.some((pattern) =>
    pattern.name === "meta.record.field-label.eidos" &&
    pattern.match.startsWith("^\\s*") &&
    pattern.match.includes("(?=\\s*:(?!:))")),
  "grammar should scope multiline record field labels at line start"
);
assert(
  grammar.repository.members.patterns.every((pattern) =>
    pattern.name !== "meta.record.field-label.eidos" || pattern.match.includes("(?!:)")),
  "grammar should not scope declarations using :: as record field labels"
);
assert(
  grammar.repository.calls.patterns.some((pattern) =>
    pattern.name === "entity.name.type.constructor.eidos"),
  "grammar should scope constructor calls"
);
assert(
  grammar.repository.patterns.patterns.some((pattern) =>
    pattern.name === "meta.pattern.view.eidos" &&
    pattern.begin.includes("->") &&
    JSON.stringify(pattern).includes("keyword.operator.view.eidos")),
  "grammar should scope view patterns such as (key_pressed(81) -> true)"
);

for (const expected of [
  "manifestLanguageVersions",
  "manifestTargetKindValues",
  "manifestTopLevelKeys",
  "manifestSectionKeys",
  "isManifestDocument",
  "validateManifestDocument",
  "getManifestCompletionItems",
  "createManifestMarkdown",
  "Unknown top-level field",
  "Unsupported language.version",
  "Unsupported target kind",
  "eidos-manifest",
  "registerDocumentSemanticTokensProvider",
  "registerInlayHintsProvider",
  "collectVariableTypeInlayHints",
  "findLetDeclarationName",
  "lastGoodSnapshotFor",
  "stale: true",
  "Stale information: this hover uses the last successful Eidos semantic snapshot",
  "hasCleanTypeText",
  "typeConfidence === \"TypedClean\"",
  "snapshotConfidence === \"TypedClean\"",
  "resolveSymbolInSnapshot",
  "last successful Eidos snapshot",
  "InlayHintKind.Type",
  "semanticTokenTypes",
  "function pushServerSemanticTokens(builder, snapshot, document, seen)",
  "\"unused\"",
  "findUnusedSymbolIds",
  "nextNonWhitespaceIs",
  "pushLexicalSemanticTokens",
  "pushQualifiedModulePrefixTokens",
  "readIdentifierLength",
  "isRecordFieldLabel",
  "previousNonWhitespaceChar",
  "[A-Za-z_][A-Za-z0-9_]*(?:(?:[/.]|::)[A-Za-z_][A-Za-z0-9_]*)*",
  "isSyntheticModulePath",
  "\"module\"",
  "\"fieldLabel\"",
  "\"patternVariable\"",
  "\"proof\"",
  "\"borrowed\"",
  "\"mutableBorrow\"",
  "\"effects\"",
  "symbol.detail === \"pattern binding\"",
  "appendCompactHoverMarkdown",
  "buildProofStateMarkdown",
  "proofStates",
  "Proof state",
  "checkStatus",
  "uiText",
  "function tr(locale, key)",
  "registerCodeActionsProvider",
  "CodeActionKind.QuickFix",
  "createStatusBarItem",
  "pkgInstall"
]) {
  assert(extension.includes(expected), `extension contract missing: ${expected}`);
}

assert(
  extension.includes("const manifestSelector = [") &&
    extension.includes("const completionSelector = [...eidosSelector, ...manifestSelector];"),
  "manifest selector should be combined with the main completion/hover selector"
);
assert(
  /if \(isManifestDocument\(document\)\) \{\r?\n\s+diagnostics\.set\(document\.uri, validateManifestDocument\(document, getLocale\(\)\)\);\r?\n\s+return;\r?\n\s+\}/.test(extension),
  "manifest documents should use extension-side diagnostics instead of semantic snapshots"
);
assert(
  /if \(isManifestDocument\(document\)\) \{\r?\n\s+return getManifestCompletionItems\(document, position, locale\);\r?\n\s+\}/.test(extension),
  "manifest completion should come from the static manifest metadata table"
);
assert(
  extension.includes("const manifestKey = getManifestHoverKey(document, position);"),
  "manifest hover should resolve manifest field metadata"
);
assert(
  extension.includes("const visible = !!document && isProjectAwareDocument(document);"),
  "status buttons should stay visible for eidos.toml"
);

const ideCommandStart = extension.indexOf("function buildIdeCommand(filePath)");
const ideAutoStart = extension.indexOf("if (cliMode === \"dotnet\")", ideCommandStart);
const ideAutoReturn = extension.indexOf("No runnable eidosc backend found", ideAutoStart);
const ideBundledFallback = extension.indexOf("if (bundledCli)", ideAutoStart);
const idePathFallback = extension.indexOf("if (isNativeExecutableCommand(cliPath) && isCommandAvailable(cliPath, workspace))", ideAutoStart);
const ideDotnetFallback = extension.indexOf("if (isCommandAvailable(dotnetPath, workspace))", ideAutoStart);
const ideWrapperFallback = extension.indexOf("if (isCommandAvailable(cliPath, workspace))", ideDotnetFallback);
assert(ideCommandStart >= 0, "extension should build IDE commands");
assert(
  ideAutoStart > ideCommandStart &&
    ideBundledFallback > ideAutoStart &&
    idePathFallback > ideBundledFallback &&
    ideDotnetFallback > idePathFallback &&
    ideWrapperFallback > ideDotnetFallback &&
    ideWrapperFallback < ideAutoReturn,
  "auto IDE backend should prefer bundled/native eidosc, then dotnet run, then wrapper commands"
);
assert(
  extension.includes("function isNativeExecutableCommand(command)") &&
    extension.includes("extension !== \".cmd\"") &&
    extension.includes("extension !== \".bat\""),
  "auto IDE backend should not treat Windows shell wrappers as fast native executables"
);
assert(
  extension.includes("function createCancellationSource()") &&
    extension.includes("function spawnProcess(command, args, cwd, stdinText, cancellationToken)") &&
    extension.includes("child.kill()"),
  "semantic subprocesses should support cancellation"
);
assert(
  extension.includes("class EidosLspClient") &&
    extension.includes("textDocument/didOpen") &&
    extension.includes("textDocument/publishDiagnostics") &&
    extension.includes("textDocument/completion") &&
    extension.includes("textDocument/hover") &&
    extension.includes("textDocument/definition") &&
    extension.includes("textDocument/references") &&
    extension.includes("textDocument/documentSymbol") &&
    extension.includes("textDocument/semanticTokens/full") &&
    extension.includes("textDocument/codeAction") &&
    extension.includes("textDocument/inlayHint") &&
    extension.includes("Content-Length:"),
  "extension should include a lightweight LSP semantic provider client"
);
assert(
  extension.includes("function useLspSemanticBackend()") &&
    extension.includes("lspClient.completion(document, position)") &&
    extension.includes("lspClient.hover(document, position)") &&
    extension.includes("lspClient.definition(document, position)") &&
    extension.includes("lspClient.references(document, position") &&
    extension.includes("lspClient.documentSymbols(document)") &&
    extension.includes("lspClient.semanticTokens(document)") &&
    extension.includes("lspClient.codeActions(document, targetRange, context)") &&
    extension.includes("lspClient.inlayHints(document, range)"),
  "interactive providers should be routable through the LSP backend"
);
assert(
  extension.includes("registerDocumentSymbolProvider") &&
    extension.includes("lspDocumentSymbolToVsCode") &&
    extension.includes("mapSymbolKind(entry.kind)"),
  "extension should provide document symbols through both LSP and IDE backends"
);
assert(
  extension.includes("const lspSemanticTokenTypes = [") &&
    extension.includes("function remapLspSemanticTokenData(data)") &&
    extension.includes("semanticTokenTypes.indexOf(name)"),
  "LSP semantic token data should be remapped to the extension semantic token legend"
);
assert(
  extension.includes("function scheduleSemanticDiagnostics(document)") &&
    extension.includes("useLspDiagnostics()") &&
    extension.includes("lspClient.syncDocument(document)"),
  "semantic diagnostics should be routable through the LSP backend"
);
assert(
  extension.includes("const LSP_FAILURE_COOLDOWN_MS = 10000;") &&
    extension.includes("markFailure(error)") &&
    extension.includes("lspClient.markFailure(error);") &&
    extension.includes("scheduleSnapshot(document);"),
  "LSP failures should cool down and fall back to the IDE snapshot backend"
);
assert(
  extension.includes("if (this.openDocuments.get(key) !== document.version)") &&
    extension.includes("this.didChange(document);"),
  "LSP provider requests should not send didChange when the document version is unchanged"
);
assert(
  extension.includes("if (!useLspDiagnostics()) {\r\n        applyDiagnostics(document, snapshot);\r\n      }") ||
    extension.includes("if (!useLspDiagnostics()) {\n        applyDiagnostics(document, snapshot);\n      }"),
  "IDE snapshots should not overwrite diagnostics owned by the LSP backend"
);
assert(
  extension.includes("const semanticJobs = new Map();") &&
    extension.includes("function semanticJobFor(key)") &&
    extension.includes("job.cancellation?.cancel();"),
  "semantic refresh should use latest-wins job state instead of waiting on stale inflight work"
);
assert(
  extension.includes("async function fetchSnapshotForInteractiveUse(document)") &&
    extension.includes("fetchSnapshotInBackground(document)") &&
    extension.includes("const snapshot = await fetchSnapshotForInteractiveUse(document);"),
  "interactive providers should use stale-while-revalidate snapshots"
);

const parsedSnapshot = extension.indexOf("const snapshot = parseJsonFromOutput(result.stdout);");
const staleDocumentGuard = extension.indexOf("if (document.version !== requestedVersion)", parsedSnapshot);
const cacheSnapshot = extension.indexOf("snapshots.set(key", parsedSnapshot);
const applySnapshotDiagnostics = extension.indexOf("applyDiagnostics(document, snapshot);", parsedSnapshot);
assert(parsedSnapshot >= 0, "semantic refresh should parse IDE JSON output");
assert(
  staleDocumentGuard > parsedSnapshot &&
    cacheSnapshot > staleDocumentGuard &&
    applySnapshotDiagnostics > staleDocumentGuard,
  "semantic refresh should discard stale document versions before caching diagnostics"
);

const semanticProviderStart = extension.indexOf("async provideDocumentSemanticTokens(document)");
const serverLayerCall = extension.indexOf("pushServerSemanticTokens(builder, snapshot, document, seen)", semanticProviderStart);
const lexicalFallbackCall = extension.indexOf("pushLexicalSemanticTokens(builder, document, seen)", semanticProviderStart);
assert(serverLayerCall > semanticProviderStart, "semantic token provider should push server semantic tokens first");
assert(lexicalFallbackCall > serverLayerCall, "lexical semantic tokens should run after the server token layer");
assert(
  /if \(!snapshot\?\.success\) \{\r?\n\s+pushLexicalSemanticTokens\(builder, document, seen\);\r?\n\s+\}/.test(extension),
  "semantic token provider should skip lexical fallback when a server snapshot succeeded"
);
assert(
  /pushTokenIfNew\(\r?\n\s+builder,\r?\n\s+seen,/.test(extension),
  "server token layer should use the shared seen set"
);

console.log("editor contract ok");
