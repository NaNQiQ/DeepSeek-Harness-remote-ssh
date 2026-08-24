# DSH Remote SSH

[简体中文](./README.zh-CN.md) | English

An external SSH execution provider for **DeepSeek Harness (DSH)**. It keeps the official DSH tools unchanged and switches their execution world between the local machine and a selected Linux server.

> Community project. Not affiliated with or endorsed by DeepSeek.

## Highlights

- Keeps the official DSH `read`, `write`, `edit`, `bash`, `glob`, `grep`, and `terminal` tools.
- No model-facing `ssh_*` / `remote_*` replacement tools.
- Switch execution targets inside the same conversation while keeping conversation context.
- Persistent, UI-only execution handoff markers in the conversation timeline.
- SSH/SFTP based filesystem, process and PTY transport.
- Official DSH search semantics are preserved; packaged ripgrep is resolved for the remote Linux architecture and cached under the remote user cache.
- Full remote absolute paths such as `/etc`, `/var`, and `/opt` remain available when the SSH account is allowed to access them.
- SSH Agent, private-key file, and ephemeral password authentication.
- Host-key fingerprint verification on first connection.
- The target Linux server does not need this plugin, DSH, Node.js, Python, or a manually installed ripgrep.

## Compatibility

Current release: `1.0.2`

- Uses the official DeepSeek Harness Bundle / Provider interfaces and does not hard-code a DSH application-version check.
- Does not patch DSH source or replace official tools; it follows the standard DSH plugin and Provider seams.
- Node.js `>= 24`.
- The Web UI is loaded through the official DSH client extension slots.

## Architecture

```text
Model
  |
  v
Official DSH tools
(read/write/edit/glob/grep/bash/terminal)
  |
  v
Official provider seams
(fs / subprocess / shell / terminals)
  |
  +--> Local providers --> local OS
  |
  +--> Remote SSH providers --> SSH/SFTP --> Linux server
```

The plugin changes **where DSH executes**, not **how DSH behaves**.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for implementation details.

## Installation

DSH supports out-of-tree bundles through profile plugins. This repository declares `dsh.bundle.patch` in `package.json`. Runtime dependencies such as `ssh2`, plus the small official DSH consumer packages mounted directly by the remote execution realm, are installed with the plugin. Host capability/service packages remain host-provided peers.

### Install from a local checkout

Clone or extract this repository, open a terminal in the repository root, then run:

```bash
npm install --omit=dev --legacy-peer-deps
dsh plugin --profile web add -w .
dsh --profile web --dump-config
dsh web
```

The dump should include the `dsh-remote-ssh` bundle.

### Install from a package archive

If you downloaded a release `.tgz`, install it through the DSH profile instead of manually copying it into a workspace:

```bash
dsh plugin --profile web add -w ./dsh-remote-ssh-1.0.2.tgz
dsh web
```

### Install from GitHub

After publishing the repository, users can install it directly with a GitHub package spec:

```bash
dsh plugin --profile web add -w github:<owner>/<repo>
dsh web
```

Pinning a commit or tag is recommended for reproducible installations:

```bash
dsh plugin --profile web add -w github:<owner>/<repo>#<tag-or-commit>
```

## Update

For a GitHub installation, a simple and predictable update flow is:

```bash
dsh plugin --profile web remove dsh-remote-ssh
dsh plugin --profile web add -w github:<owner>/<repo>#<tag-or-commit>
dsh web
```

For local development, reinstall from the checkout:

```bash
dsh plugin --profile web remove dsh-remote-ssh
npm install --omit=dev --legacy-peer-deps
dsh plugin --profile web add -w .
dsh web
```

## Uninstall

Remove the bundle from the Web profile:

```bash
dsh plugin --profile web remove dsh-remote-ssh
```

Restart DSH afterward.

Optional cleanup:

- Plugin state is stored under the DSH process working directory at `.dsh-remote-ssh/state.json`.
- The remote ripgrep cache is stored under `~/.cache/dsh-remote-ssh/dsh-tools/` on servers where search tools were used.

Both can be left in place. Delete them only if you want to remove saved server metadata / cached helper binaries as well.

## Authentication

### SSH Agent / system keychain — recommended

The plugin asks the system SSH Agent to sign SSH authentication challenges. It does not read the Agent-managed private-key contents.

The onboarding guide is OS-specific and covers:

1. Generate or prepare an SSH key.
2. Authorize the public key on the server.
3. Add the private key to the system SSH Agent.
4. Verify Agent-only login.
5. On Windows, optionally back up and remove the ordinary private-key file after Agent login has been verified.

Only the **public key** is copied to the server. The private key is never uploaded by the onboarding command.

### Private-key file

The server configuration stores only the configured key path. The plugin reads that private-key file when establishing SSH connections.

For passphrase-protected keys, SSH Agent mode is recommended.

### Ephemeral password

The password is kept only in the current DSH Host process memory and is used for connection/reconnection during that process lifetime.

It is not written to:

- `.dsh-remote-ssh/state.json`
- browser `localStorage`
- browser `sessionStorage`

Restarting the DSH Host intentionally forgets the password.

## Security notes

- Model-provider API keys and model Base URLs are **not managed by this plugin** and are not included in this repository. Configure them through DSH itself.
- SSH Agent forwarding is not enabled by this plugin.
- Remote execution does not expose the Host filesystem through the remote provider.
- Local mode deliberately keeps native DSH behavior. If local DSH can read a file with the current OS user's permissions, this plugin does not add a prompt-based or path-based block.
- Server records contain non-secret connection metadata, authentication mode, optional private-key path, and trusted host-key fingerprint. Password contents are not persisted.

Please report security issues privately before publishing details. See [SECURITY.md](./SECURITY.md).

## Development

Static syntax check:

```bash
npm run check
```

The plugin is an external DSH bundle and does not require modifying the DeepSeek Harness source checkout.

## License

[MIT](./LICENSE)

## Links

- DeepSeek Harness: https://github.com/deepseek-ai/deepseek-harness
- LINUX DO: https://linux.do/
