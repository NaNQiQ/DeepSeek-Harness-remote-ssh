# Security Policy

## Reporting

Please report suspected vulnerabilities privately before publishing exploit details.

When reporting, include the affected plugin version, DSH version, operating system, authentication mode, and minimal reproduction steps. Do not include real passwords, private keys, API keys, access tokens, or other credentials.

## Credential boundary

- SSH Agent mode requests signatures from the system Agent and does not read Agent-managed private-key contents.
- Private-key mode reads the explicitly selected/default local private-key file when establishing an SSH connection; only its path is persisted by the plugin.
- Password mode keeps the password in DSH Host process memory only and intentionally forgets it when the Host exits.
- SSH Agent forwarding is not enabled.
- Model-provider API keys and model Base URLs are outside this plugin and must be managed by DSH.

## Native local DSH behavior

The plugin intentionally preserves native DSH behavior when the local execution world is selected. It does not add path blacklists or prompt-based restrictions to local DSH tools.
