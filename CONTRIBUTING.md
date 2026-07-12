# Contributing to Eidosc Tools

## Workflow

1. Create a short-lived branch from the latest `main`.
2. Keep changes focused and add or update contract tests.
3. Run the local verification commands.
4. Open a pull request targeting `main`.
5. Use squash merge after review and required checks.

Use a Conventional Commits subject and one of the branch prefixes `feat/`,
`fix/`, `chore/`, `docs/`, `perf/`, `refactor/`, or `test/`.

## Verification

```powershell
npm test
npx --yes @vscode/vsce package --pre-release
```

Changes to Eidos syntax, semantic tokens, manifest fields, diagnostics, or
language-service behavior must stay aligned with a compatible Eidosc release.
Do not commit generated VSIX packages, local editor state, logs, credentials,
or private test data.
