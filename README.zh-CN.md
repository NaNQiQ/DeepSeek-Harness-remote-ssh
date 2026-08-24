# DSH Remote SSH

简体中文 | [English](./README.md)

一个面向 **DeepSeek Harness（DSH）** 的外部 SSH 执行环境插件。它不重写 DSH 官方工具，只把官方工具的执行位置在“本地电脑”和“选定的 Linux 服务器”之间切换。

> 社区项目，与 DeepSeek 官方无隶属或背书关系。

## 功能特点

- 保留 DSH 官方 `read / write / edit / bash / glob / grep / terminal`。
- 不向模型新增 `ssh_*`、`remote_*` 等替代工具。
- 同一对话中可以在本地与不同服务器之间切换，原对话上下文继续保留。
- 切换执行环境后，在对话时间线中显示持久的 UI 切换标记；标记不属于用户/助手消息，也不会发送给模型。
- 文件通过 SFTP，命令与 PTY 通过 SSH 执行。
- 保留 DSH 官方搜索语义；官方搜索需要的 ripgrep 会按远端 Linux 架构解析并缓存到远端用户缓存目录。
- `cwd` 只是默认工作目录，不是文件系统边界；SSH 账号有权限时仍可访问 `/etc`、`/var`、`/opt` 等绝对路径。
- 支持 SSH Agent、私钥文件、临时密码三种认证方式。
- 首次连接支持 SSH Host Key 指纹核对。
- 目标 Linux 服务器无需安装本插件、DSH、Node.js、Python，也不要求手动安装 ripgrep。

## 兼容性

当前版本：`1.0.2`

- 使用 DeepSeek Harness 官方 Bundle / Provider 接口，不写死 DSH 应用版本检查。
- 不修改 DSH 源码，不替换官方 Tool；DSH 保持标准插件与 Provider 接口即可使用。
- Node.js `>= 24`。
- Web 界面通过 DSH 官方客户端扩展槽加载。

## 架构

```text
模型
  |
  v
DSH 官方工具
(read/write/edit/glob/grep/bash/terminal)
  |
  v
DSH 官方 Provider 接缝
(fs / subprocess / shell / terminals)
  |
  +--> 本地 Provider --> 本地操作系统
  |
  +--> Remote SSH Provider --> SSH/SFTP --> Linux 服务器
```

插件只改变 **DSH 在哪里执行**，不改变 **DSH 怎么使用工具**。

更详细的实现说明见 [ARCHITECTURE.md](./ARCHITECTURE.md)。

## 安装

DSH 官方支持通过 profile 安装树外 bundle。本项目的 `package.json` 已声明 `dsh.bundle.patch`。`ssh2` 等运行依赖，以及远程执行环境直接挂载的少量 DSH 官方 consumer 包，会随插件安装；DSH 的能力/服务包仍由宿主提供。

### 从本地源码安装

克隆或解压本仓库后，在仓库根目录执行：

```bash
npm install --omit=dev --legacy-peer-deps
dsh plugin --profile web add -w .
dsh --profile web --dump-config
dsh web
```

`--dump-config` 中应能看到 `dsh-remote-ssh` bundle。

### 从发布包安装

如果下载的是 Release `.tgz`，直接通过 DSH profile 安装，不要手动复制进 workspace：

```bash
dsh plugin --profile web add -w ./dsh-remote-ssh-1.0.2.tgz
dsh web
```

### 从 GitHub 安装

仓库公开后，可以直接使用 GitHub package spec：

```bash
dsh plugin --profile web add -w github:<owner>/<repo>
dsh web
```

正式使用建议固定 tag 或 commit，避免上游更新导致行为变化：

```bash
dsh plugin --profile web add -w github:<owner>/<repo>#<tag-or-commit>
```

## 更新

GitHub 安装建议使用清晰可控的“卸载旧版 → 安装新版”方式：

```bash
dsh plugin --profile web remove dsh-remote-ssh
dsh plugin --profile web add -w github:<owner>/<repo>#<tag-or-commit>
dsh web
```

本地开发则重新安装当前 checkout：

```bash
dsh plugin --profile web remove dsh-remote-ssh
npm install --omit=dev --legacy-peer-deps
dsh plugin --profile web add -w .
dsh web
```

## 卸载

从 Web profile 移除插件：

```bash
dsh plugin --profile web remove dsh-remote-ssh
```

然后重启 DSH。

可选清理：

- 插件状态文件位于 DSH 进程工作目录下的 `.dsh-remote-ssh/state.json`。
- 使用过 `glob / grep` 的远程服务器可能存在 `~/.cache/dsh-remote-ssh/dsh-tools/` 缓存。

这两项不删除也不会影响卸载；只有希望同时清除已保存的服务器元数据或远端缓存时才需要手动删除。

## 认证方式

### SSH Agent / 系统钥匙串（推荐）

插件只向系统 SSH Agent 请求 SSH 签名，不读取 Agent 管理的私钥正文。

“新服务器连接引导”会根据当前系统显示对应步骤：

1. 准备或生成 SSH 密钥。
2. 把 **公钥** 授权到目标服务器。
3. 把私钥加入系统 SSH Agent。
4. 验证仅使用 Agent 的登录。
5. Windows 下可在验证成功后，先安全备份，再按需移除普通私钥文件。

引导命令上传到服务器的只有 **公钥**，不会上传私钥。

### 私钥文件

服务器配置只保存私钥路径；建立 SSH 连接时，插件会读取该私钥文件。

如果私钥设置了 passphrase，更推荐使用 SSH Agent。

### 密码（临时，不保存）

密码只保存在当前 DSH Host 进程内存中，用于本次进程生命周期内的连接和断线重连。

密码不会写入：

- `.dsh-remote-ssh/state.json`
- 浏览器 `localStorage`
- 浏览器 `sessionStorage`

重启 DSH Host 后需要重新输入。

## 安全说明

- **模型提供商的 API Key 和模型 Base URL 不由本插件管理，本仓库也不包含这些信息。** 请继续通过 DSH 自身进行模型配置。
- 本插件不启用 SSH Agent Forwarding。
- 远程 Execution World 不通过 Remote Provider 暴露 Host 本地文件系统。
- 本地模式刻意保持原生 DSH 行为：如果当前系统用户本来有权限读取某个本地文件，本插件不会额外用 Prompt 或路径黑名单拦截它。
- 持久化服务器记录只包含非敏感连接元数据、认证方式、可选私钥路径和已信任的 Host Key 指纹；密码正文不落盘。

安全问题请优先私下报告，详见 [SECURITY.md](./SECURITY.md)。

## 开发检查

运行静态语法检查：

```bash
npm run check
```

这是一个 DSH 外部 bundle，不需要修改 DeepSeek Harness 官方源码。

## 开源协议

[MIT](./LICENSE)

## 友链

- DeepSeek Harness：https://github.com/deepseek-ai/deepseek-harness
- LINUX DO：https://linux.do/
