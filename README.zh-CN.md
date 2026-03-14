# openintern3

[English](./README.md) | 简体中文

`openintern3` 是一个借鉴 microkernel 思想、以 plugin 为中心的工作流引擎。

内核保持很小，只负责插件生命周期、事件总线、日志和 capability 基础设施。具体状态、能力、SDK 接入和业务逻辑都放在 plugin 内部。

## 当前状态

当前仓库已经可以运行，并且已经具备这些能力：

- `Application` 负责插件挂载和 capability 注册
- capability 注册与调用链路已经打通
- 基于事件总线的 channel 消息路由已经可用
- CLI 已支持历史记录，持久化到 `.openintern3/history`
- agent session 已持久化到 `.openintern3/agent/sessions`
- 已接入 WhatsApp 和 WeCom
- 仓库内已实现 Feishu plugin
- 已提供 web search capability
- 已提供 terminals capability
- 已提供 cron capability
- 已提供 echo capability

## 架构

- `src/kernel/`：插件生命周期、事件总线、日志、capability 基础类型
- `src/service/`：capability registry 和 invoker
- `src/application.ts`：注册插件并挂到内核
- `src/index.ts`：CLI 入口
- `plugins/*`：各个独立能力单元

核心约定：

- 万物皆 plugin
- kernel 不承载业务能力
- plugin 对外暴露 capability
- plugin 之间优先通过 capability 和事件协作

## 当前默认加载的 Plugin

当前入口 `src/index.ts` 默认加载：

- `echo`
- `cron`
- `web-search`
- `agent`
- `terminals`
- `whatsapp`
- `wecom`

`feishu` 已经在仓库里实现，但当前默认入口没有启用。

## 当前 Capability

默认加载并可用：

- `echo.ping`
- `cron.add`
- `cron.delete`
- `cron.list`
- `web_search.search`
- `agent.spawn`
- `terminals.start`
- `terminals.list`
- `terminals.tail`
- `terminals.kill`
- `terminals.exec`
- `whatsapp.start`
- `whatsapp.stop`
- `whatsapp.status`
- `whatsapp.send_message`
- `whatsapp.pull_messages`
- `wecom.start`
- `wecom.stop`
- `wecom.status`
- `wecom.send_message`
- `wecom.pull_messages`

仓库里已经实现，但默认未加载：

- `feishu.start`
- `feishu.stop`
- `feishu.status`
- `feishu.send_message`
- `feishu.pull_messages`

## 各 Plugin 已有功能

### Agent

- 订阅 `channel` namespace 的入站消息
- 支持多轮 tool/capability 调用循环
- session 会落盘持久化
- 支持 provider 侧 tool calling
- 会把用户可见进度回传给 CLI 和 channel
- 提供 `agent.spawn` 子代理能力

### Terminals

- 可启动后台 shell 进程
- 可执行一次性命令
- 输出落盘到 `.openintern3/terminals/output`
- 支持列出、tail、kill 已管理进程

### Web Search

- 提供给 agent 使用的 web search capability

### WhatsApp

- 支持二维码登录
- 认证目录在 `.openintern3/whatsapp/auth`
- 媒体目录在 `.openintern3/whatsapp/media`
- 入站消息会通过事件总线转发给 agent

### WeCom

- 基于 WebSocket 的机器人连接
- 媒体目录在 `.openintern3/wecom/media`
- 入站消息会通过事件总线转发给 agent

### Feishu

- plugin 实现已经存在
- start/stop/status/send/pull capability 已完成
- 当前默认入口未启用

## 启动

安装根依赖：

```bash
bun install
```

启动 CLI：

```bash
bun run dev
```

也可以：

```bash
bun run start
```

## CLI

常用命令：

```text
/help
/plugin list
/plugin get agent
/plugin wecom start
/plugin whatsapp start
/plugin terminals exec "uname -a"
```

CLI 历史文件：

```text
.openintern3/history
```

## 环境变量

常见 agent/provider 配置：

```env
AGENT_PROVIDER_API_KEY=...
AGENT_PROVIDER_API_BASE=...
AGENT_PROVIDER_DEFAULT_MODEL=...
```

示例 channel 配置：

```env
WHATSAPP_ENABLED=true
WECOM_ENABLED=true
WECOM_BOT_ID=...
WECOM_SECRET=...
```

完整可选项请直接看各 plugin 源码。

## 类型检查

```bash
./node_modules/.bin/tsc --noEmit
```
