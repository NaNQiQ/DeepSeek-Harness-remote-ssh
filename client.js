window.__ModuleLoader__.load({ id: "dsh-remote-ssh", factory: (require) => {
var module = { exports: {} }; var exports = module.exports;
"use strict";

const React = require("react");
const {
  Button: DshButton,
  Input: DshInput,
  Modal,
  StateDot,
  writeClipboard,
} = require("@deepseek-ai/dsh-client-ui-primitives");

const h = React.createElement;
const { useEffect, useMemo, useRef, useState } = React;
const RPC_CHANNEL = "/dsh-remote-ssh";

const css = `
.dshrs-root{position:relative;display:inline-flex;align-items:center;font:inherit;font-family:var(--dsw-font-family,inherit);color:var(--dsw-alias-label-primary,currentColor)}
.dshrs-trigger{height:28px;max-width:210px;display:inline-flex;align-items:center;gap:6px;padding:0 7px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-secondary,currentColor);font:inherit;cursor:pointer;transition:background-color .12s ease,color .12s ease}
.dshrs-trigger:hover,.dshrs-trigger:focus-visible{background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-2,transparent));color:var(--dsw-alias-label-primary,currentColor);outline:none}
.dshrs-trigger[disabled]{opacity:.5;cursor:not-allowed}
.dshrs-trigger-name{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshrs-chevron{opacity:.62;line-height:1}
.dshrs-menu{position:absolute;left:0;bottom:calc(100% + 8px);z-index:80;width:292px;max-height:min(440px,62vh);overflow:auto;padding:6px;border:1px solid var(--dsw-alias-border-l1,var(--dsw-alias-stroke-primary,color-mix(in srgb,currentColor 24%,transparent)));border-radius:12px;background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base,Canvas));box-shadow:var(--dsw-shadow-popover,0 10px 36px color-mix(in srgb,currentColor 16%,transparent));font:inherit;font-family:var(--dsw-font-family,inherit)}
.dshrs-menu-label{padding:7px 9px 5px;color:var(--dsw-alias-label-caption,var(--dsw-alias-label-secondary,currentColor));font:inherit;opacity:.82}
.dshrs-menu-sep{height:1px;margin:5px 4px;background:var(--dsw-alias-border-l1,var(--dsw-alias-stroke-primary,color-mix(in srgb,currentColor 18%,transparent)))}
.dshrs-menu-row{width:100%;min-height:40px;display:flex;align-items:center;gap:9px;padding:7px 9px;border:0;border-radius:8px;background:transparent;color:var(--dsw-alias-label-primary,currentColor);font:inherit;text-align:left;cursor:pointer}
.dshrs-menu-row:hover,.dshrs-menu-row:focus-visible{background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-1,transparent));outline:none}
.dshrs-menu-row[disabled]{opacity:.46;cursor:not-allowed}
.dshrs-menu-main{min-width:0;flex:1}
.dshrs-menu-title{font:inherit;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshrs-menu-sub{margin-top:2px;color:var(--dsw-alias-label-caption,var(--dsw-alias-label-secondary,currentColor));font:inherit;opacity:.72;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshrs-menu-error{padding:7px 9px;color:var(--dsw-alias-label-secondary,currentColor);font:inherit;opacity:.9;white-space:normal;overflow-wrap:anywhere;word-break:break-word}
.dshrs-check{width:14px;flex:0 0 14px;text-align:center;color:var(--dsw-alias-brand-primary,currentColor);font:inherit}
body [role="dialog"]:has(.dshrs-modal){width:min(760px,calc(100vw - 56px))!important;max-width:min(760px,calc(100vw - 56px))!important;box-sizing:border-box!important}
.dshrs-modal{width:100%;min-width:0;max-width:none;max-height:min(78vh,780px);overflow-y:auto;overflow-x:hidden;display:grid;gap:18px;padding-right:2px;color:var(--dsw-alias-label-primary,currentColor);box-sizing:border-box;font:inherit;font-family:var(--dsw-font-family,inherit)}
.dshrs-copy{color:var(--dsw-alias-label-secondary,currentColor);font:inherit}
.dshrs-section{display:grid;gap:12px;min-width:0}
.dshrs-field{display:grid;align-content:start;gap:6px;min-width:0}
.dshrs-label{font:inherit;font-weight:600;min-width:0}
.dshrs-hint-slot{min-height:18px}
.dshrs-hint{color:var(--dsw-alias-label-caption,var(--dsw-alias-label-secondary,currentColor));font:inherit;opacity:.75;min-width:0}
.dshrs-control,.dshrs-field input,.dshrs-field textarea,.dshrs-field select{width:100%!important;min-width:0!important;max-width:100%!important;box-sizing:border-box!important;font:inherit!important;font-family:var(--dsw-font-family,inherit)!important}
.dshrs-native-select{min-height:36px;border-radius:8px;padding:0 10px;border:1px solid var(--dsw-alias-border-l1,var(--dsw-alias-stroke-primary,color-mix(in srgb,currentColor 24%,transparent)));background:var(--dsw-alias-bg-layer-1,transparent);color:var(--dsw-alias-label-primary,currentColor);font:inherit;outline:none}
.dshrs-native-select:focus{border-color:var(--dsw-alias-brand-primary,currentColor)}
.dshrs-grid2{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:14px 18px;align-items:start;min-width:0}
.dshrs-grid2>*{min-width:0}
.dshrs-actions{display:flex;align-items:center;justify-content:flex-end;gap:8px;padding-top:2px}
.dshrs-actions-between{display:flex;align-items:center;justify-content:space-between;gap:8px;padding-top:2px}
.dshrs-status{display:flex;align-items:flex-start;gap:9px;padding:10px 11px;border:1px solid var(--dsw-alias-border-l1,var(--dsw-alias-stroke-primary,color-mix(in srgb,currentColor 20%,transparent)));border-radius:9px;background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-1,transparent));font:inherit}
.dshrs-status-copy{min-width:0;flex:1}
.dshrs-status-title{font:inherit;font-weight:600}
.dshrs-status-text{margin-top:3px;color:var(--dsw-alias-label-secondary,currentColor);font:inherit;opacity:.88;white-space:pre-wrap;word-break:break-word}
.dshrs-code{display:flex;align-items:flex-start;gap:8px;margin-top:7px;padding:8px 9px;border-radius:8px;background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base,transparent));border:1px solid var(--dsw-alias-border-l1,var(--dsw-alias-stroke-primary,color-mix(in srgb,currentColor 18%,transparent)))}
.dshrs-code code{min-width:0;flex:1;font-family:var(--ds-font-family-code,ui-monospace,SFMono-Regular,Consolas,monospace);font-size:.9em;line-height:1.55;white-space:pre-wrap;word-break:break-all;color:var(--dsw-alias-label-primary,currentColor)}
.dshrs-text-button{border:0;background:transparent;color:var(--dsw-alias-brand-primary,currentColor);font:inherit;padding:0;cursor:pointer}
.dshrs-text-button:hover{text-decoration:underline}
.dshrs-advanced{border:0;background:transparent;color:var(--dsw-alias-label-secondary,currentColor);font:inherit;padding:0;width:max-content;cursor:pointer}
.dshrs-server-list{display:grid;gap:2px}
.dshrs-server-card{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:12px;align-items:center;padding:10px 0;border-bottom:1px solid var(--dsw-alias-border-l1,var(--dsw-alias-stroke-primary,color-mix(in srgb,currentColor 14%,transparent)))}
.dshrs-server-card:last-child{border-bottom:0}
.dshrs-server-id{min-width:0}
.dshrs-server-title{display:flex;align-items:center;gap:7px;font:inherit;font-weight:600;min-width:0}
.dshrs-server-sub{margin-top:2px;color:var(--dsw-alias-label-caption,var(--dsw-alias-label-secondary,currentColor));font:inherit;opacity:.72;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.dshrs-mini-actions{display:flex;align-items:center;gap:8px}
.dshrs-onboarding{display:grid;gap:12px;padding:14px;border:1px solid var(--dsw-alias-border-l1,var(--dsw-alias-stroke-primary,color-mix(in srgb,currentColor 18%,transparent)));border-radius:10px;background:var(--dsw-alias-bg-module-platform,var(--dsw-alias-bg-layer-1,transparent));font:inherit}
.dshrs-onboarding-head{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}
.dshrs-onboarding-title{font:inherit;font-weight:600}
.dshrs-onboarding-copy{margin-top:3px;color:var(--dsw-alias-label-secondary,currentColor);font:inherit;opacity:.86}
.dshrs-platform-tabs{display:flex;gap:4px;padding:3px;border-radius:9px;background:var(--dsw-alias-bg-layer-1,var(--dsw-alias-bg-base,transparent));width:max-content;max-width:100%}
.dshrs-platform-tab{border:0;border-radius:7px;padding:6px 10px;background:transparent;color:var(--dsw-alias-label-secondary,currentColor);font:inherit;cursor:pointer}
.dshrs-platform-tab[data-active="true"]{background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base,Canvas));color:var(--dsw-alias-label-primary,currentColor);box-shadow:0 1px 2px color-mix(in srgb,currentColor 10%,transparent)}
.dshrs-guide{display:grid;gap:11px}
.dshrs-guide-step{display:grid;grid-template-columns:24px minmax(0,1fr);gap:9px;align-items:start}
.dshrs-guide-num{width:22px;height:22px;border-radius:50%;display:grid;place-items:center;background:var(--dsw-alias-bg-layer-2,var(--dsw-alias-bg-base,transparent));color:var(--dsw-alias-label-secondary,currentColor);font:inherit;line-height:1}
.dshrs-guide-title{font:inherit;font-weight:600}
.dshrs-guide-note{margin-top:3px;color:var(--dsw-alias-label-caption,var(--dsw-alias-label-secondary,currentColor));font:inherit;opacity:.78}
.dshrs-security{display:grid;gap:6px;padding-top:2px;color:var(--dsw-alias-label-secondary,currentColor);font:inherit;opacity:.86}
.dshrs-auth-explain{margin-top:-2px;color:var(--dsw-alias-label-secondary,currentColor);font:inherit;opacity:.86}
.dshrs-danger{color:var(--dsw-alias-state-error-primary,var(--dsw-alias-label-secondary,currentColor))}
.dshrs-handoff-node{width:100%;box-sizing:border-box;display:grid;grid-template-columns:minmax(36px,1fr) auto minmax(36px,1fr);align-items:center;gap:12px;margin:8px 0 6px;padding:0;color:var(--dsw-alias-label-caption,var(--dsw-alias-label-secondary,currentColor));font:inherit;font-size:.88em;line-height:1.35;opacity:.82;pointer-events:none}
.dshrs-handoff-node-line{height:1px;min-width:36px;width:100%;background:var(--dsw-alias-border-l1,var(--dsw-alias-stroke-primary,color-mix(in srgb,currentColor 20%,transparent)))}
.dshrs-handoff-node-text{min-width:0;max-width:min(560px,72vw);overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:center}
@media (max-width:720px){body [role="dialog"]:has(.dshrs-modal){width:calc(100vw - 24px)!important;max-width:calc(100vw - 24px)!important}.dshrs-grid2{grid-template-columns:1fr}.dshrs-modal{max-height:80vh}.dshrs-menu{width:min(292px,86vw)}}
`;

function ensureStyles() {
  if (document.getElementById("dshrs-style")) return;
  const style = document.createElement("style");
  style.id = "dshrs-style";
  style.textContent = css;
  document.head.appendChild(style);
}

const runtimeStateCache = new Map();
const runtimeStateListeners = new Map();
const runtimeStateRequests = new Map();

function publishRuntimeState(sessionId, state) {
  const id = String(sessionId || "");
  if (!id || !state) return;
  runtimeStateCache.set(id, state);
  for (const listener of runtimeStateListeners.get(id) || []) listener(state);
}

function subscribeRuntimeState(sessionId, listener) {
  const id = String(sessionId || "");
  if (!id) return () => {};
  let listeners = runtimeStateListeners.get(id);
  if (!listeners) { listeners = new Set(); runtimeStateListeners.set(id, listeners); }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
    if (!listeners.size) runtimeStateListeners.delete(id);
  };
}

function loadRuntimeState(sessionId, rpc) {
  const id = String(sessionId || "");
  if (!id) return Promise.resolve(null);
  const cached = runtimeStateCache.get(id);
  if (cached) return Promise.resolve(cached);
  const existing = runtimeStateRequests.get(id);
  if (existing) return existing;
  const request = rpc("state", { sessionId: id }).then(next => {
    publishRuntimeState(id, next);
    return next;
  }).finally(() => {
    if (runtimeStateRequests.get(id) === request) runtimeStateRequests.delete(id);
  });
  runtimeStateRequests.set(id, request);
  return request;
}

function useRuntimeState(sessionId, rpc) {
  const id = String(sessionId || "");
  const [state, setState] = useState(() => runtimeStateCache.get(id) || null);
  useEffect(() => {
    ensureStyles();
    if (!id) { setState(null); return undefined; }
    let active = true;
    const cached = runtimeStateCache.get(id);
    if (cached) setState(cached);
    const dispose = subscribeRuntimeState(id, next => { if (active) setState(next); });
    if (!cached) loadRuntimeState(id, rpc).catch(() => {});
    return () => { active = false; dispose(); };
  }, [id, rpc]);
  return state;
}

const HANDOFF_EVENT = "dsh-remote-ssh/execution-handoff";
const HANDOFF_NODE_KIND = "dsh-remote-ssh-execution-handoff";

const handoffDefinition = {
  kind: HANDOFF_NODE_KIND,
  target: "chat",
  match: event => event?.type === HANDOFF_EVENT
    ? { id: String(event?.data?.handoffId || event?.seq || "handoff"), role: "start" }
    : null,
  start: (_context, match) => {
    const data = match?.event?.data || {};
    return {
      name: String(data?.to?.name || "服务器"),
      platform: String(data?.to?.platform || "Linux"),
    };
  },
  update: context => context.state,
  publication: () => "immediate",
  buildViewNode: context => {
    if (!context?.state) return null;
    const event = context?.start?.event || context?.matches?.[0]?.event;
    return {
      key: context.key,
      kind: HANDOFF_NODE_KIND,
      id: context.id,
      target: "chat",
      anchorSeq: Number(event?.seq || 0),
      location: context?.start?.location || context?.matches?.[0]?.location || { kind: "unresolved" },
      visibility: "visible",
      data: context.state,
    };
  },
};

function ExecutionHandoffNode({ node }) {
  const name = String(node?.data?.name || "服务器");
  const platform = String(node?.data?.platform || "Linux");
  const text = `已切换执行环境：${name} · ${platform}`;
  return h("div", { className: "dshrs-handoff-node", role: "note", title: text, "aria-label": text },
    h("span", { className: "dshrs-handoff-node-line", "aria-hidden": true }),
    h("span", { className: "dshrs-handoff-node-text" }, text),
    h("span", { className: "dshrs-handoff-node-line", "aria-hidden": true }),
  );
}

function localButton(props, children) {
  if (DshButton) return h(DshButton, props, children);
  return h("button", { type: "button", ...props }, children);
}

function nativeInput(props) {
  const next = {
    ...props,
    className: `${props?.className || ""} dshrs-control`.trim(),
    style: { width: "100%", minWidth: 0, ...(props?.style || {}) },
  };
  if (DshInput) return h(DshInput, next);
  return h("input", next);
}

function dot(state) {
  if (!state || !StateDot) return null;
  return h(StateDot, { state });
}

function Field({ label, hint, children }) {
  return h("label", { className: "dshrs-field" },
    h("span", { className: "dshrs-label" }, label),
    children,
    hint ? h("span", { className: "dshrs-hint" }, hint) : null,
  );
}

async function copy(text) {
  if (typeof writeClipboard === "function") {
    await writeClipboard(String(text));
    return;
  }
  await navigator.clipboard.writeText(String(text));
}

function Command({ text }) {
  const [copied, setCopied] = useState(false);
  async function onCopy() {
    try {
      await copy(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1200);
    } catch {}
  }
  return h("div", { className: "dshrs-code" },
    h("code", null, text),
    h("button", { type: "button", className: "dshrs-text-button", onClick: onCopy }, copied ? "已复制" : "复制"),
  );
}

function defaultGuidePlatform(hostPlatform) {
  if (hostPlatform === "win32") return "windows";
  if (hostPlatform === "darwin") return "macos";
  return "linux";
}

function safeGuideTarget(form) {
  const username = String(form.username || "").trim();
  const host = String(form.host || "").trim();
  if (!/^[A-Za-z0-9._-]+$/u.test(username)) return null;
  if (!/^[A-Za-z0-9.:%_\[\]-]+$/u.test(host)) return null;
  return `${username}@${host}`;
}

function guideServerName(form) {
  return String(form.name || "").trim() || "这台服务器";
}

function psQuote(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

function shQuote(value) {
  return `'${String(value).replace(/'/g, `'"'"'`)}'`;
}

function posixKeyAssignment(value) {
  const raw = String(value || "").trim();
  if (!raw) return 'key="$HOME/.ssh/id_ed25519"';
  if (raw.startsWith("~/")) {
    const rest = raw.slice(2).replace(/(["\\$`])/g, "\\$1");
    return `key="$HOME/${rest}"`;
  }
  return `key=${shQuote(raw)}`;
}

function agentGuideCommands(platform, form) {
  const target = safeGuideTarget(form);
  const port = Number(form.port || 22);
  if (!target || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  const verify = `ssh -o BatchMode=yes -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no -o PreferredAuthentications=publickey -o IdentityFile=none -p ${port} ${target} "echo SSH_KEY_OK"`;
  if (platform === "windows") {
    return {
      terminal: "PowerShell",
      generate: 'if (-not (Test-Path "$env:USERPROFILE\\.ssh\\id_ed25519")) { ssh-keygen -t ed25519 -a 64 -f "$env:USERPROFILE\\.ssh\\id_ed25519" } else { Write-Host "SSH key already exists" }',
      install: `Get-Content "$env:USERPROFILE\\.ssh\\id_ed25519.pub" | ssh -p ${port} ${target} "umask 077; mkdir -p ~/.ssh; cat >> ~/.ssh/authorized_keys; chmod 700 ~/.ssh; chmod 600 ~/.ssh/authorized_keys"`,
      agent: 'Get-Service ssh-agent | Set-Service -StartupType Automatic; Start-Service ssh-agent; ssh-add "$env:USERPROFILE\\.ssh\\id_ed25519"; ssh-add -l',
      verify,
      agentNote: "如提示 passphrase，请只在系统终端输入。",
      protectNote: "确认 Agent 登录成功后，可以先把私钥安全备份，再从本机普通目录移除私钥文件。插件不会自动删除；没有备份或恢复入口时不要删除。公钥 .pub 可以保留。",
    };
  }
  if (platform === "macos") {
    return {
      terminal: "Terminal",
      generate: 'test -f "$HOME/.ssh/id_ed25519" || ssh-keygen -t ed25519 -a 64 -f "$HOME/.ssh/id_ed25519"',
      install: `cat "$HOME/.ssh/id_ed25519.pub" | ssh -p ${port} ${target} 'umask 077; mkdir -p ~/.ssh; cat >> ~/.ssh/authorized_keys; chmod 700 ~/.ssh; chmod 600 ~/.ssh/authorized_keys'`,
      agent: 'ssh-add --apple-use-keychain "$HOME/.ssh/id_ed25519" && ssh-add -l',
      verify,
      agentNote: "如果私钥有 passphrase，按系统提示输入一次并加入 macOS Keychain / ssh-agent。",
      protectNote: "macOS 的 Agent 生命周期与 Windows 不同，建议保留受 passphrase 保护的私钥文件，不要按 Windows 的方式直接删除。",
    };
  }
  return {
    terminal: "Terminal",
    generate: 'test -f "$HOME/.ssh/id_ed25519" || ssh-keygen -t ed25519 -a 64 -f "$HOME/.ssh/id_ed25519"',
    install: `cat "$HOME/.ssh/id_ed25519.pub" | ssh -p ${port} ${target} 'umask 077; mkdir -p ~/.ssh; cat >> ~/.ssh/authorized_keys; chmod 700 ~/.ssh; chmod 600 ~/.ssh/authorized_keys'`,
    agent: 'ssh-add "$HOME/.ssh/id_ed25519" && ssh-add -l',
    verify,
    agentNote: "DSH 需要从能访问当前 SSH_AUTH_SOCK 的环境启动；如果 Agent 尚未启动，请先在启动 DSH 的会话中配置 Agent。",
    protectNote: "Linux 的 Agent 通常是登录会话级，建议保留受 passphrase 保护的私钥文件，以便重新加载。",
  };
}

function privateKeyGuideCommands(platform, form) {
  const target = safeGuideTarget(form);
  const port = Number(form.port || 22);
  if (!target || !Number.isInteger(port) || port < 1 || port > 65535) return null;
  const configured = String(form.keyPath || "").trim();
  if (platform === "windows") {
    const assignment = configured
      ? `$key = ${psQuote(configured)}`
      : '$key = "$env:USERPROFILE\\.ssh\\id_ed25519"';
    return {
      terminal: "PowerShell",
      pathLabel: configured || "%USERPROFILE%\\.ssh\\id_ed25519（默认）",
      publicKey: `${assignment}; ssh-keygen -y -f $key`,
      install: `${assignment}; ssh-keygen -y -f $key | ssh -p ${port} ${target} "umask 077; mkdir -p ~/.ssh; cat >> ~/.ssh/authorized_keys; chmod 700 ~/.ssh; chmod 600 ~/.ssh/authorized_keys"`,
      verify: `${assignment}; ssh -i $key -o IdentitiesOnly=yes -o BatchMode=yes -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no -p ${port} ${target} "echo SSH_KEY_OK"`,
    };
  }
  const assignment = posixKeyAssignment(configured);
  return {
    terminal: "Terminal",
    pathLabel: configured || "~/.ssh/id_ed25519（默认）",
    publicKey: `${assignment}; ssh-keygen -y -f "$key"`,
    install: `${assignment}; ssh-keygen -y -f "$key" | ssh -p ${port} ${target} 'umask 077; mkdir -p ~/.ssh; cat >> ~/.ssh/authorized_keys; chmod 700 ~/.ssh; chmod 600 ~/.ssh/authorized_keys'`,
    verify: `${assignment}; ssh -i "$key" -o IdentitiesOnly=yes -o BatchMode=yes -o PasswordAuthentication=no -o KbdInteractiveAuthentication=no -p ${port} ${target} "echo SSH_KEY_OK"`,
  };
}

function GuideStep({ number, title, note, command }) {
  return h("div", { className: "dshrs-guide-step" },
    h("div", { className: "dshrs-guide-num" }, String(number)),
    h("div", null,
      h("div", { className: "dshrs-guide-title" }, title),
      note ? h("div", { className: "dshrs-guide-note" }, note) : null,
      command ? h(Command, { text: command }) : null,
    ),
  );
}

function GuidePlatforms({ platform, onPlatform }) {
  return h("div", { className: "dshrs-platform-tabs", role: "tablist", "aria-label": "DSH Host 操作系统" },
    [["windows", "Windows"], ["macos", "macOS"], ["linux", "Linux / Ubuntu"]].map(([value, label]) =>
      h("button", { key: value, type: "button", className: "dshrs-platform-tab", "data-active": platform === value ? "true" : "false", onClick: () => onPlatform(value) }, label),
    ),
  );
}

function ConnectionGuide({ form, hostPlatform, platform, onPlatform }) {
  const serverName = guideServerName(form);

  if (form.authType === "password") {
    return h("div", { className: "dshrs-onboarding" },
      h("div", { className: "dshrs-onboarding-head" },
        h("div", null,
          h("div", { className: "dshrs-onboarding-title" }, `连接「${serverName}」 · 密码认证`),
          h("div", { className: "dshrs-onboarding-copy" }, "密码认证不需要生成 SSH 密钥，也不需要配置 authorized_keys。"),
        ),
      ),
      h("div", { className: "dshrs-guide" },
        h(GuideStep, { number: 1, title: "输入 SSH 密码", note: "密码只保存在当前 DSH Host 进程内存中，不写入插件配置或浏览器存储；重启 DSH 后需要重新输入。" }),
        h(GuideStep, { number: 2, title: "点击“测试并保存”", note: "插件会测试 SSH、SFTP 和远程 Shell；全部成功后才保存非敏感服务器配置并切换当前对话。" }),
      ),
      h("div", { className: "dshrs-security" },
        h("div", null, "• 这个模式不会安装或修改服务器上的 SSH 公钥。"),
        h("div", null, "• 首次连接仍会校验 SSH Host Key 指纹。"),
      ),
    );
  }

  if (form.authType === "key") {
    const commands = privateKeyGuideCommands(platform, form);
    return h("div", { className: "dshrs-onboarding" },
      h("div", { className: "dshrs-onboarding-head" },
        h("div", null,
          h("div", { className: "dshrs-onboarding-title" }, `连接「${serverName}」 · 私钥文件`),
          h("div", { className: "dshrs-onboarding-copy" }, "适合已经有明确私钥文件的场景。插件连接时会读取该私钥；带 passphrase 的私钥请改用 SSH Agent。"),
        ),
      ),
      h(GuidePlatforms, { platform, onPlatform }),
      commands ? h("div", { className: "dshrs-guide" },
        h(GuideStep, { number: 1, title: "确认要使用的私钥", note: `当前：${commands.pathLabel}。如果还没有 SSH 密钥，推荐改选 SSH Agent 后再按 Agent 引导生成。`, command: commands.publicKey }),
        h(GuideStep, { number: 2, title: `将对应公钥授权到「${serverName}」`, note: "写入服务器的仍然只是公钥。若服务器尚未授权当前密钥，系统 ssh 可能在终端提示现有登录凭据；插件不会获取该密码。", command: commands.install }),
        h(GuideStep, { number: 3, title: "验证私钥登录", note: "成功应输出 SSH_KEY_OK。然后回到这里点击“测试并保存”。", command: commands.verify }),
        h("div", { className: "dshrs-security" },
          h("div", null, "• 配置只保存私钥路径，不保存私钥正文；但连接时插件需要读取该文件。"),
          h("div", null, "• 如果希望插件完全不读取私钥正文，请使用 SSH Agent。"),
        ),
      ) : h(Status, { state: "warning", title: "先填写连接信息" }, "填写有效的服务器地址、用户名和 SSH 端口后，这里会生成当前服务器对应的命令。"),
    );
  }

  const commands = agentGuideCommands(platform, form);
  return h("div", { className: "dshrs-onboarding" },
    h("div", { className: "dshrs-onboarding-head" },
      h("div", null,
        h("div", { className: "dshrs-onboarding-title" }, `连接「${serverName}」 · SSH Agent`),
        h("div", { className: "dshrs-onboarding-copy" }, "同一把 Agent 密钥可以授权给多台服务器。"),
      ),
    ),
    h(GuidePlatforms, { platform, onPlatform }),
    commands ? h("div", { className: "dshrs-guide" },
      h(GuideStep, { number: 1, title: `打开 ${commands.terminal}，检查或生成 SSH 密钥`, note: "新生成时建议设置 passphrase。", command: commands.generate }),
      h(GuideStep, { number: 2, title: `将公钥授权到「${serverName}」`, note: "只上传公钥，私钥不会上传。首次授权时，系统 ssh 可能在终端要求现有登录凭据；插件不会获取。", command: commands.install }),
      h(GuideStep, { number: 3, title: "把私钥加入系统 SSH Agent", note: commands.agentNote, command: commands.agent }),
      h(GuideStep, { number: 4, title: "验证 Agent 登录", note: "仅验证 SSH Agent，不使用密码或本地私钥文件回退。成功会输出 SSH_KEY_OK。", command: commands.verify }),
      h(GuideStep, { number: 5, title: platform === "windows" ? "保护本机私钥（可选）" : "保护本机私钥", note: commands.protectNote }),
      h("div", { className: "dshrs-security" },
        h("div", null, "• Agent 模式下插件只请求签名，不读取私钥正文。服务器端只保存公钥。"),
        h("div", null, "• 首次连接仍会校验 SSH Host Key 指纹。"),
      ),
    ) : h(Status, { state: "warning", title: "先填写连接信息" }, "填写有效的服务器地址、用户名和 SSH 端口后，这里会生成当前服务器对应的命令。"),
  );
}

function ErrorStatus({ error, form, hostPlatform, onTrust, onOpenGuide, busy }) {
  if (!error) return null;
  const code = error.code || "INTERNAL";
  const target = `${form.username || "root"}@${form.host || "SERVER"}`;
  const port = Number(form.port || 22);
  const ssh = `ssh -p ${port} ${target}`;

  if (code === "HOST_KEY_UNTRUSTED") {
    const fp = error.details?.fingerprint || "";
    const verifyHostKey = `for f in /etc/ssh/ssh_host_*_key.pub; do [ -f "$f" ] && ssh-keygen -lf "$f" -E sha256; done`;
    return h("div", { className: "dshrs-status" },
      dot("warning"),
      h("div", { className: "dshrs-status-copy" },
        h("div", { className: "dshrs-status-title" }, "首次连接：请确认服务器指纹"),
        h("div", { className: "dshrs-status-text" }, fp
          ? `服务器返回：${fp}\n请优先从云厂商 VNC/串口控制台登录服务器，在服务器本机执行下面的命令。输出中必须有一行 SHA256 指纹与上面完全一致，再点击信任。`
          : "请先通过云厂商 VNC/串口控制台核对这台服务器的 SSH Host Key 指纹。"),
        h(Command, { text: verifyHostKey }),
        h("div", { className: "dshrs-guide-note", style: { marginTop: 5 } }, "不要只用同一条尚未信任的 SSH 网络连接来证明它自己；云控制台/串口属于独立核对通道。"),
        h("div", { className: "dshrs-guide-note", style: { marginTop: 5 } }, `普通手动登录命令仍是：${ssh}`),
        h("div", { className: "dshrs-actions", style: { paddingTop: 8 } },
          localButton({ onClick: () => onTrust(fp), disabled: busy || !fp }, "我已核对，信任并保存"),
        ),
      ),
    );
  }

  if (code === "HOST_KEY_CHANGED") {
    return h(Status, { state: "error", title: "服务器身份发生变化" }, "已保存的 SSH 指纹与当前服务器不一致。为安全起见插件已拒绝连接，请确认服务器是否重装或更换后再编辑连接信息。");
  }

  if (["AUTH_FAILED", "KEY_NOT_FOUND", "KEY_PASSPHRASE_REQUIRED", "AGENT_UNAVAILABLE", "PASSWORD_REQUIRED"].includes(code)) {
    const message = code === "KEY_NOT_FOUND"
      ? "没有找到可用的标准 SSH 私钥，或指定的私钥路径无法读取。"
      : code === "KEY_PASSPHRASE_REQUIRED"
        ? "检测到带口令的私钥。推荐把它加入系统 SSH Agent，而不是把私钥口令交给插件。"
        : code === "AGENT_UNAVAILABLE"
          ? "当前选择了 SSH Agent，但没有找到可用 Agent/密钥。"
          : code === "PASSWORD_REQUIRED"
            ? "这台服务器使用密码认证。密码不会持久化；DSH 重启后需要重新输入 SSH 密码，再点“测试并保存”。"
            : "服务器可以到达，但 SSH 身份验证失败。请检查当前认证方式和凭据。";
    return h("div", { className: "dshrs-status" },
      dot("warning"),
      h("div", { className: "dshrs-status-copy" },
        h("div", { className: "dshrs-status-title" }, "SSH 身份验证未完成"),
        h("div", { className: "dshrs-status-text" }, message),
        code === "AGENT_UNAVAILABLE" ? h("div", { style: { marginTop: 7 } },
          hostPlatform === "win32"
            ? h(Command, { text: 'Set-Service -Name ssh-agent -StartupType Automatic; Start-Service ssh-agent; ssh-add -l' })
            : h(Command, { text: "ssh-add -l" }),
          h("div", { className: "dshrs-guide-note", style: { marginTop: 5 } }, hostPlatform === "win32"
            ? "这条命令要在运行 DSH 的 Windows 电脑上执行；Set-Service / Start-Service 请使用管理员 PowerShell。最后应列出至少一把密钥；如果没有，请打开下面的连接引导。"
            : "这里必须能看到至少一把密钥。普通 ssh 能登录并不能证明 Agent 可用，因为系统 ssh 可能直接读取 ~/.ssh 私钥，甚至回退到密码登录。"),
        ) : null,
        onOpenGuide ? h("div", { style: { marginTop: 7 } }, h("button", { type: "button", className: "dshrs-text-button", onClick: onOpenGuide }, "查看新服务器连接引导")) : null,
      ),
    );
  }

  const titleMap = {
    NETWORK_TIMEOUT: "连接超时",
    NETWORK_REFUSED: "SSH 端口拒绝连接",
    HOST_NOT_FOUND: "找不到服务器地址",
    CANCELLED: "操作已取消",
    ACTIVATE_FAILED: "切换执行环境失败",
  };
  const messageMap = {
    NETWORK_TIMEOUT: "请检查服务器地址、SSH 端口、云安全组和网络连通性。",
    NETWORK_REFUSED: "请确认 SSH 服务正在运行，并且端口/安全组配置正确。",
    HOST_NOT_FOUND: "请检查服务器主机名或 IP 是否填写正确。",
  };
  const raw = String(error.message || "");
  const generic = /invalid_union|Invalid input|transport failure|HTTP 500/iu.test(raw)
    ? "DSH 与插件的通信失败。详细原因已记录到启动 DSH 的终端日志。"
    : raw || "请查看启动 DSH 的终端日志获取详细信息。";
  return h(Status, { state: code === "CANCELLED" ? "warning" : "error", title: titleMap[code] || "连接失败" }, messageMap[code] || generic);
}

function Status({ state, title, children }) {
  return h("div", { className: "dshrs-status" },
    dot(state),
    h("div", { className: "dshrs-status-copy" },
      h("div", { className: "dshrs-status-title" }, title),
      children ? h("div", { className: "dshrs-status-text" }, children) : null,
    ),
  );
}

function normalizeRpcError(value) {
  if (!value) return { code: "INTERNAL", message: "未知错误", details: {} };
  if (value.code) return { code: String(value.code), message: String(value.message || "操作失败"), details: value.details || {} };
  if (value.error?.code) return { code: String(value.error.code), message: String(value.error.message || "操作失败"), details: value.error.details || {} };
  const raw = String(value.message || value);
  return { code: "INTERNAL", message: raw.length > 320 ? `${raw.slice(0, 320)}…` : raw, details: {} };
}

function blankServer() {
  return { id: "", name: "", host: "", port: 22, username: "root", authType: "agent", keyPath: "", password: "", remoteRoot: "~", hostKeyFingerprint: "" };
}

function fromServer(server) {
  if (!server) return blankServer();
  return {
    id: server.id || "",
    name: server.name || "",
    host: server.host || "",
    port: server.port || 22,
    username: server.username || "root",
    // Legacy `auto` entries are shown as standard private-key mode. The
    // underlying stored value is not changed until the user tests+saves.
    authType: server.auth?.type === "agent" ? "agent" : server.auth?.type === "password" ? "password" : "key",
    keyPath: server.auth?.type === "key" ? server.auth.keyPath || "" : "",
    password: "",
    remoteRoot: server.remoteRoot || "~",
    hostKeyFingerprint: server.hostKeyFingerprint || "",
  };
}

function toServer(form) {
  return {
    ...(form.id ? { id: form.id } : {}),
    name: String(form.name || "").trim(),
    host: String(form.host || "").trim(),
    port: Number(form.port || 22),
    username: String(form.username || "").trim(),
    auth: form.authType === "agent"
      ? { type: "agent" }
      : form.authType === "password"
        ? { type: "password" }
        : { type: "key", ...(String(form.keyPath || "").trim() ? { keyPath: String(form.keyPath || "").trim() } : {}) },
    remoteRoot: String(form.remoteRoot || "~").trim() || "~",
    ...(form.hostKeyFingerprint ? { hostKeyFingerprint: form.hostKeyFingerprint } : {}),
  };
}

function validate(form) {
  if (!String(form.name || "").trim()) return "请输入服务器名称";
  if (!String(form.host || "").trim()) return "请输入服务器 IP 或主机名";
  if (!String(form.username || "").trim()) return "请输入 SSH 用户名";
  const port = Number(form.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) return "SSH 端口必须是 1–65535 之间的整数";
  return "";
}

function ServerEditor({ server, sessionId, hostPlatform, rpc, onSaved, onCancel }) {
  const [form, setForm] = useState(() => fromServer(server));
  const [advanced, setAdvanced] = useState(Boolean(server?.remoteRoot && server.remoteRoot !== "~"));
  const [guideOpen, setGuideOpen] = useState(!server?.id);
  const [guidePlatform, setGuidePlatform] = useState(() => defaultGuidePlatform(hostPlatform));
  const [working, setWorking] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    setForm(fromServer(server));
    setError(null);
    setGuideOpen(!server?.id);
    setAdvanced(Boolean(server?.remoteRoot && server.remoteRoot !== "~"));
  }, [server?.id]);
  useEffect(() => { setGuidePlatform(defaultGuidePlatform(hostPlatform)); }, [hostPlatform]);
  const set = (key, value) => setForm(old => ({ ...old, [key]: value }));

  async function testAndSave(allowFingerprint) {
    const issue = validate(form);
    if (issue) { setError({ code: "VALIDATION", message: issue, details: {} }); return; }
    setWorking(true); setError(null);
    try {
      const result = await rpc("server.testAndSave", {
        sessionId,
        server: toServer(form),
        ...(form.authType === "password" && String(form.password || "") ? { password: String(form.password) } : {}),
        ...(allowFingerprint ? { allowFingerprint } : {}),
      });
      setForm(old => ({ ...old, id: result.server?.id || old.id, hostKeyFingerprint: result.fingerprint || old.hostKeyFingerprint, password: "" }));
      try {
        await rpc("target.set", { sessionId, target: { type: "ssh", serverId: result.server.id } });
      } catch (e) {
        const cause = normalizeRpcError(e);
        setError({
          code: "ACTIVATE_FAILED",
          message: "SSH 测试和服务器保存已成功，但切换当前对话的执行环境失败：" + cause.message,
          details: cause.details || {},
        });
        return;
      }
      await onSaved(result.server.id);
    } catch (e) { setError(normalizeRpcError(e)); }
    finally { setWorking(false); }
  }

  const authExplain = form.authType === "agent"
    ? "插件通过系统 SSH Agent 完成认证，不读取私钥正文。"
    : form.authType === "password"
      ? "密码仅保存在当前 DSH 进程内存，重启后需重新输入。"
      : "仅保存私钥路径；连接时插件会读取该文件。带 passphrase 的私钥请使用 SSH Agent。";
  const keyPlaceholder = hostPlatform === "win32" ? "C:\\Users\\me\\.ssh\\id_ed25519" : "~/.ssh/id_ed25519";

  return h("div", { className: "dshrs-modal" },
    h("div", { className: "dshrs-copy" }, server?.id
      ? "修改 SSH 连接信息。远程服务器无需安装 DSH Remote SSH、DSH 或其他 Agent。"
      : "添加一台 Linux/Unix SSH 服务器。连接成功后，当前对话的官方 DSH 工具将在该服务器执行。"),
    h("div", { className: "dshrs-section" },
      h("div", { className: "dshrs-grid2" },
        h(Field, { label: "名称" }, nativeInput({ value: form.name, onChange: e => set("name", e.target.value), placeholder: "生产服务器" })),
        h(Field, { label: "服务器地址" }, nativeInput({ value: form.host, onChange: e => set("host", e.target.value), placeholder: "server.example.com" })),
        h(Field, { label: "用户名" }, nativeInput({ value: form.username, onChange: e => set("username", e.target.value), placeholder: "root" })),
        h(Field, { label: "SSH 端口" }, nativeInput({ type: "number", min: 1, max: 65535, value: form.port, onChange: e => set("port", e.target.value), placeholder: "22" })),
      ),
      h(Field, { label: "认证方式" },
        h("select", {
          className: "dshrs-control dshrs-native-select",
          value: form.authType,
          onChange: e => { set("authType", e.target.value); set("password", ""); setError(null); },
        },
          h("option", { value: "agent" }, "SSH Agent / 系统钥匙串（推荐）"),
          h("option", { value: "key" }, "私钥文件"),
          h("option", { value: "password" }, "密码（临时，不保存）"),
        ),
      ),
      h("div", { className: "dshrs-auth-explain" }, authExplain),
      form.authType === "key"
        ? h(Field, { label: "私钥路径（可选）", hint: "留空时尝试系统默认私钥；填写后只使用这个文件。" }, nativeInput({ value: form.keyPath, onChange: e => set("keyPath", e.target.value), placeholder: keyPlaceholder }))
        : null,
      form.authType === "password"
        ? h(Field, { label: "SSH 密码" }, nativeInput({ type: "password", autoComplete: "off", "data-lpignore": "true", "data-1p-ignore": "true", name: "dsh-remote-ssh-session-secret", value: form.password, onChange: e => set("password", e.target.value), placeholder: "输入 SSH 密码" }))
        : null,
      h("button", { type: "button", className: "dshrs-advanced", onClick: () => setAdvanced(v => !v) }, advanced ? "▾ 收起高级设置" : "› 高级设置"),
      advanced ? h("div", { className: "dshrs-section" },
        h(Field, { label: "默认工作目录", hint: "这里只决定默认 cwd，不限制 /etc、/var、/opt 等绝对路径。" }, nativeInput({ value: form.remoteRoot, onChange: e => set("remoteRoot", e.target.value), placeholder: "~" })),
      ) : null,
      h("button", { type: "button", className: "dshrs-advanced", onClick: () => setGuideOpen(v => !v) }, guideOpen ? "▾ 收起新服务器连接引导" : "› 新服务器连接引导"),
      guideOpen ? h(ConnectionGuide, { form, hostPlatform, platform: guidePlatform, onPlatform: setGuidePlatform }) : null,
    ),
    error?.code === "VALIDATION"
      ? h(Status, { state: "warning", title: "信息还不完整" }, error.message)
      : h(ErrorStatus, { error, form, hostPlatform, busy: working, onTrust: fp => testAndSave(fp), onOpenGuide: () => setGuideOpen(true) }),
    h("div", { className: "dshrs-actions-between" },
      localButton({ onClick: onCancel, disabled: working }, "取消"),
      h("div", { className: "dshrs-actions", style: { paddingTop: 0 } },
        localButton({ onClick: () => testAndSave(), disabled: working }, working ? "正在测试并保存…" : "测试并保存"),
      ),
    ),
  );
}

function connectionDot(info) {
  if (info?.state === "connected") return "done";
  if (info?.state === "connecting") return "ongoing";
  if (info?.state === "error") return "error";
  return null;
}

function ServerManager({ state, sessionId, rpc, reload, onEdit, onAdd }) {
  const [working, setWorking] = useState("");
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  async function reconnect(server) {
    setWorking(server.id); setError(null); setNotice(null);
    try {
      await rpc("server.reconnect", { sessionId, serverId: server.id });
      await reload();
      setNotice(`“${server.name}” 已重新建立 SSH 连接`);
    }
    catch (e) { setError(normalizeRpcError(e)); }
    finally { setWorking(""); }
  }

  async function remove(server) {
    if (!window.confirm(`删除服务器“${server.name}”？\n这只会从 DSH 中移除连接，不会修改服务器。`)) return;
    setWorking(server.id); setError(null);
    try { await rpc("server.remove", { sessionId, serverId: server.id }); await reload(); }
    catch (e) { setError(normalizeRpcError(e)); }
    finally { setWorking(""); }
  }

  return h("div", { className: "dshrs-modal" },
    h("div", { className: "dshrs-copy" }, "服务器配置保存在 DSH Host。连接由 Host 维护并复用；切换对话不会为同一台服务器反复建立新的 SSH TCP 连接。"),
    error ? h(Status, { state: "error", title: "操作失败" }, error.message) : null,
    notice ? h(Status, { state: "done", title: "重连成功" }, notice) : null,
    state.servers.length ? h("div", { className: "dshrs-server-list" }, state.servers.map(server => {
      const conn = state.connections?.[server.id];
      return h("div", { className: "dshrs-server-card", key: server.id },
        h("div", { className: "dshrs-server-id" },
          h("div", { className: "dshrs-server-title" }, dot(connectionDot(conn)), h("span", null, server.name)),
          h("div", { className: "dshrs-server-sub" }, `${server.username}@${server.host}:${server.port} · ${conn?.state === "connected" ? "已连接" : conn?.state === "connecting" ? "连接中" : "按需连接"}`),
        ),
        h("div", { className: "dshrs-mini-actions" },
          h("button", { type: "button", className: "dshrs-text-button", disabled: working === server.id, onClick: () => reconnect(server) }, working === server.id ? "重连中…" : "重连"),
          h("button", { type: "button", className: "dshrs-text-button", disabled: working === server.id, onClick: () => onEdit(server) }, "编辑"),
          h("button", { type: "button", className: "dshrs-text-button dshrs-danger", disabled: working === server.id, onClick: () => remove(server) }, "删除"),
        ),
      );
    })) : h(Status, { state: null, title: "还没有服务器" }, "添加一台 SSH 服务器后，就可以在对话输入框旁直接选择它。"),
    h("div", { className: "dshrs-actions" }, localButton({ onClick: onAdd }, "添加服务器")),
  );
}

function TargetPicker({ sessionId, rpc }) {
  const rootRef = useRef(null);
  const [state, setState] = useState(null);
  const [menu, setMenu] = useState(false);
  const [modal, setModal] = useState(null);
  const [editing, setEditing] = useState(null);
  const [working, setWorking] = useState(false);
  const [error, setError] = useState(null);

  async function reload() {
    if (!sessionId) return;
    try {
      const next = await rpc("state", { sessionId });
      setState(next); publishRuntimeState(sessionId, next); setError(null);
    }
    catch (e) { setError(normalizeRpcError(e)); }
  }

  useEffect(() => { ensureStyles(); reload(); }, [sessionId]);
  useEffect(() => {
    if (!menu) return undefined;
    const timer = setInterval(reload, 5000);
    const outside = event => { if (rootRef.current && !rootRef.current.contains(event.target)) setMenu(false); };
    document.addEventListener("pointerdown", outside);
    return () => { clearInterval(timer); document.removeEventListener("pointerdown", outside); };
  }, [menu, sessionId]);

  const selected = useMemo(() => {
    if (state?.target?.type !== "ssh") return null;
    return state.servers?.find(server => server.id === state.target.serverId) || null;
  }, [state]);

  async function choose(target) {
    if (!state || state.busy || working) return;
    setWorking(true); setError(null);
    try {
      const next = await rpc("target.set", { sessionId, target });
      setState(next); publishRuntimeState(sessionId, next); setMenu(false);
    }
    catch (e) { setError(normalizeRpcError(e)); }
    finally { setWorking(false); }
  }

  async function onSaved() {
    setModal(null); setEditing(null); await reload();
  }

  const conn = selected ? state?.connections?.[selected.id] : null;
  const triggerDot = selected ? connectionDot(conn) : null;
  const title = selected?.name || "本地电脑";

  return h("div", { className: "dshrs-root", ref: rootRef },
    h("button", {
      type: "button",
      className: "dshrs-trigger",
      onClick: () => { setMenu(v => !v); if (!menu) reload(); },
      title: state?.busy ? "当前 Agent 正在运行，本轮执行位置已锁定" : "选择执行位置",
      disabled: !sessionId,
    },
      triggerDot ? dot(triggerDot) : null,
      h("span", { className: "dshrs-trigger-name" }, title),
      state?.busy ? h("span", { className: "dshrs-chevron", "aria-hidden": true }, "●") : h("span", { className: "dshrs-chevron", "aria-hidden": true }, "▾"),
    ),
    menu ? h("div", { className: "dshrs-menu", role: "menu" },
      h("div", { className: "dshrs-menu-label" }, state?.busy ? "本轮执行位置已锁定" : "执行位置"),
      h("button", { type: "button", className: "dshrs-menu-row", disabled: state?.busy || working, onClick: () => choose({ type: "local" }) },
        h("span", { className: "dshrs-check" }, selected ? "" : "✓"),
        h("div", { className: "dshrs-menu-main" },
          h("div", { className: "dshrs-menu-title" }, "本地电脑"),
          h("div", { className: "dshrs-menu-sub" }, "DSH Host"),
        ),
      ),
      state?.servers?.length ? h(React.Fragment, null,
        h("div", { className: "dshrs-menu-sep" }),
        h("div", { className: "dshrs-menu-label" }, "服务器"),
        state.servers.map(server => {
          const c = state.connections?.[server.id];
          return h("button", { key: server.id, type: "button", className: "dshrs-menu-row", disabled: state?.busy || working, onClick: () => choose({ type: "ssh", serverId: server.id }) },
            h("span", { className: "dshrs-check" }, selected?.id === server.id ? "✓" : ""),
            dot(connectionDot(c)),
            h("div", { className: "dshrs-menu-main" },
              h("div", { className: "dshrs-menu-title" }, server.name),
              h("div", { className: "dshrs-menu-sub" }, `${server.username}@${server.host}:${server.port}${c?.state === "connected" ? " · 已连接" : ""}`),
            ),
          );
        }),
      ) : null,
      error ? h("div", { className: "dshrs-menu-error", title: error.message }, `切换失败${error.code ? ` [${error.code}]` : ""}：${error.message}`) : null,
      h("div", { className: "dshrs-menu-sep" }),
      h("button", { type: "button", className: "dshrs-menu-row", onClick: () => { setMenu(false); setEditing(null); setModal("edit"); } },
        h("span", { className: "dshrs-check" }, "+"),
        h("div", { className: "dshrs-menu-main" }, h("div", { className: "dshrs-menu-title" }, "添加服务器")),
      ),
      state?.servers?.length ? h("button", { type: "button", className: "dshrs-menu-row", onClick: () => { setMenu(false); setModal("manage"); } },
        h("span", { className: "dshrs-check" }),
        h("div", { className: "dshrs-menu-main" }, h("div", { className: "dshrs-menu-title" }, "管理服务器")),
      ) : null,
    ) : null,
    h(Modal, {
      open: modal === "edit",
      onClose: () => { if (!working) { setModal(null); setEditing(null); } },
      closeLabel: "关闭",
      title: editing ? `编辑服务器 · ${editing.name}` : "添加服务器",
    }, modal === "edit" ? h(ServerEditor, { server: editing, sessionId, hostPlatform: state?.hostPlatform, rpc, onSaved, onCancel: () => { setModal(null); setEditing(null); } }) : null),
    h(Modal, {
      open: modal === "manage",
      onClose: () => setModal(null),
      closeLabel: "关闭",
      title: "服务器",
    }, modal === "manage" && state ? h(ServerManager, {
      state, sessionId, rpc, reload,
      onAdd: () => { setEditing(null); setModal("edit"); },
      onEdit: server => { setEditing(server); setModal("edit"); },
    }) : null),
  );
}

const name = "dsh-remote-ssh-client";
const inject = ["slots", "connection", "conversationEvents"];

function apply(ctx) {
  const rpc = async (method, payload, signal) => {
    let transport;
    try {
      transport = await ctx.connection.rpc.call(RPC_CHANNEL, method, payload, signal);
    } catch (error) {
      const raw = String(error?.message || error);
      if (/failed to fetch|fetch failed|networkerror/i.test(raw)) {
        throw {
          code: "RPC_TRANSPORT_FAILED",
          message: "DSH Host 连接在请求期间中断。这不是普通 SSH 认证失败；请查看启动 DSH 的终端中的 DSH Remote SSH SSH test 日志。",
          details: { method: String(method), raw },
        };
      }
      throw error;
    }
    // DSH Connection owns the outer RpcResult schema. DSH Remote SSH domain errors
    // travel inside a successful transport payload to preserve plugin-specific
    // codes such as AUTH_FAILED and HOST_KEY_UNTRUSTED.
    if (transport && transport.ok === false) throw transport.error;
    const body = transport && transport.ok === true && Object.prototype.hasOwnProperty.call(transport, "value")
      ? transport.value
      : transport;
    const isDomainEnvelope = body?.dshrs === 1 || body?.ywrt === 1;
    if (isDomainEnvelope && body.ok === false) throw body.error;
    if (isDomainEnvelope && body.ok === true) return body.value;
    return body;
  };

  ctx.conversationEvents.register(handoffDefinition);
  ctx.slots.inject("conversation.chat.node", () => ctx.slots.register({
    name: "conversation.chat.node",
    key: HANDOFF_NODE_KIND,
  }, ExecutionHandoffNode));

  ctx.slots.inject("conversation.input.left", () => ctx.slots.register({
    name: "conversation.input.left",
    id: "dsh-remote-ssh:runtime-target",
    order: 25,
    inject: () => ({ rpc }),
  }, TargetPicker));
}

module.exports = { name, inject, apply };
return module.exports;
} });
