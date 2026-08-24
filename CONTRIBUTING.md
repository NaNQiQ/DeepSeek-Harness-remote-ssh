# Contributing

Contributions are welcome.

1. Install development dependencies with `pnpm install --ignore-scripts`; optional native SSH addons are not used by the release bundle.
2. Fork the repository and create a focused branch.
3. Keep model-facing DSH tools unchanged; changes should stay behind official DSH Provider / extension seams.
4. Do not commit passwords, private keys, API keys, host-specific secrets, or local state files.
5. Run `pnpm run check` before opening a pull request. This regenerates the committed `dist/index.js` release artifact.
6. Commit the regenerated `dist/index.js` whenever Host source or SSH dependencies change.
7. Describe behavior changes and compatibility considerations in the pull request.

For security issues, follow [SECURITY.md](./SECURITY.md) instead of opening a public issue first.
