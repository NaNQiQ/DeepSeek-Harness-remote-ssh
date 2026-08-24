# Changelog

## 1.0.2

- Fix RPC response-envelope mismatch introduced during the package rename.
- `server.testAndSave` now returns the saved server correctly to the client, so "Test and Save" can immediately switch the current conversation to the new SSH execution target.
- Client accepts the legacy internal envelope marker during upgrades.

## 1.0.1 - 2026-08-24

Packaging fix for out-of-tree DSH profile installs.

- Declare the official `@deepseek-ai/dsh-bash-local` and `@deepseek-ai/dsh-tool-terminal` consumers as plugin runtime dependencies because the remote execution realm mounts them directly and they are not guaranteed to exist in every host profile fallback.
- Keep DSH capability/service packages as host-provided peers so the plugin still composes with the running Harness services.
- No SSH transport, provider, UI, authentication, or model-facing tool behavior changed from 1.0.0.

## 1.0.0 - 2026-08-24

First public release of DSH Remote SSH.

- Remote Linux execution through native DSH filesystem, subprocess, shell and terminal providers.
- Local / remote execution switching inside the same conversation.
- SSH Agent, private-key file and ephemeral password authentication.
- Host-key fingerprint verification.
- SFTP filesystem transport and SSH process / PTY transport.
- Remote ripgrep resolution and cache while preserving official DSH search behavior.
- Persistent, UI-only execution handoff markers.
- OS-specific onboarding guides for SSH authentication.
