# openintern3

本项目是一个借鉴 microkernel 思想的工作流引擎。

核心约定：

- 万物皆 plugin
- kernel 只负责挂载 plugin
- kernel 只负责信号传递与事件路由
- plugin 负责工具、状态、能力与具体业务逻辑

架构理解：

- `src/kernel/` 是内核层，关注插件生命周期、事件总线、类型系统
- `plugins/` 是能力层，每个 plugin 都是独立单元
- `Application` 负责加载 plugin，并把它们挂到 kernel 上
- `EventBus` 负责 plugin 间的信号传播，而不是承载业务实现
- `Application` 默认不内置任何 plugin，入口显式 `registerPlugin(...)`

设计目标：

- 用统一的 plugin 抽象承载一切能力
- 用最小 kernel 保持系统简单、可替换、可扩展
- 让 workflow 通过 plugin 组合而不是硬编码流程实现
- 让 LLM、终端、文件系统、定时器等能力都能作为 plugin 接入

协作建议：

- 新能力优先实现为新 plugin，而不是直接改 kernel
- kernel 改动应尽量保持最小，只处理挂载、路由、生命周期、信号
- plugin 之间优先通过事件和 capability/service 协作，不直接耦合内部实现


## 当前实现状态

当前仓库已经从早期 `tool/plugin method` 模式，切到以 `capability` 为中心的方向。

现状重点：

- `agent` 不是第一公民，`capability` 才是第一公民
- `tools()` 兼容层已经删除，CLI 现在直接调用 plugin 公共方法
- `src/kernel/capability.ts` 是统一 capability 抽象
- `src/service/` 是 capability 基础设施层
- plugin 的能力通过 `capabilities()` 暴露并注册


## 已完成

### Kernel / Service

- `CapabilityProvider` 已落在 `src/kernel/capability.ts`
- `CapabilityProvider` 构造时会用 zod 校验 `descriptor.input/output`
- 已有四类 service 抽象：
  - registry
  - invoker
  - policy
  - isolation
- 已有默认实现：
  - `src/service/impl/in-memory/capability-registry.ts`
  - `src/service/impl/in-memory/capability-invoker.ts`
  - `src/service/impl/default/capability-policy.ts`
  - `src/service/impl/default/capability-isolation.ts`

### Plugin 注入

- `Plugin` 基类有受保护的 `inject`
- 当前内核注入项：
  - `capabilityRegistry`
  - `capabilityInvoker`
- plugin 内可通过：
  - `this.registry()`
  - `this.invoker()`
  获取 service

### Capability 注册

- `Application` 在 plugin 初始化后自动注册 `plugin.capabilities()`
- 当前已注册 capability 的 plugin：
  - `echo`
  - `cron`
  - `filesystem`
  - `feishu`
  - `whatsapp`

当前 capability：

- `echo.ping`
- `cron.add`
- `cron.delete`
- `cron.list`
- `filesystem.read_file`
- `filesystem.write_file`
- `filesystem.edit_file`
- `filesystem.list_dir`
- `filesystem.inspect_file`
- `feishu.start`
- `feishu.stop`
- `feishu.status`
- `feishu.send_message`
- `feishu.pull_messages`
- `whatsapp.start`
- `whatsapp.stop`
- `whatsapp.status`
- `whatsapp.send_message`
- `whatsapp.pull_messages`

### Agent

- `plugins/agent` 已替代旧 `llm` 方向
- `agent` provider 请求体会携带 `tools/tool_choice`
- provider 已支持：
  - tool call 解析
  - SSE payload 解析
- `plugins/agent/src/response-parser.ts` 已从旧 `plugins/llm` 抽出：
  - `sanitizeMessages`
  - `parseToolCalls`
  - `parseSsePayload`
  - `summarizeResponseBody`
- `AgentPlugin.run()` 已具备最小 loop：
  - 组装 capability tools
  - 调 provider
  - 解析 tool calls
  - 通过 capability invoker 执行
  - 将 tool result 回填消息链
- `AgentPlugin` 现在会订阅 `channel` namespace 的 `message.received`
- 当前已接入：
  - `whatsapp -> agent -> whatsapp`
- 需要环境变量：
  - `WHATSAPP_AGENT_ENABLED=true`

### CLI

- CLI 现在有两个模式：
  - `cliAgent`
  - `cliDebugger`
- 默认模式已经是 `cliAgent`
- `cliAgent` 直接把输入送到 `agent.runSession(...)`
- `cliDebugger` 仍可用 `/plugin ...` 做调试

当前 CLI 关键命令：

- `/help`
- `/reset`
- `/debug`
- `/agent`
- `/plugin list`
- `/plugin get <name>`
- `/plugin <name> <method> ...`
- `whatsapp` / `feishu` 当前也暴露了 plugin 公共方法用于调试：
  - `start`
  - `stop`
  - `status`
  - `sendMessage`
  - `pullMessages`

### Session

- `AgentPlugin` 已不再让 `CliEngine` 维护历史
- 已新增最小 `plugins/agent/src/session-store.ts`
- 当前 agent session 支持：
  - `getOrCreate`
  - `save`
  - `clear`
  - `getHistory(maxMessages)`
- 当前 session 已落盘到：
  - `sessions/agent/*.jsonl`

### Application / Entry

- `Application` 已拆到 `src/application.ts`
- `Application` 当前职责：
  - 管理 plugin 生命周期
  - 注入 registry / invoker
  - 注册 capability
  - 代理 CLI 执行
- 入口 `src/index.ts` 显式加载并注册 plugin
- 当前默认加载：
  - `echo`
  - `cron`
  - `filesystem`
  - `agent`
  - `terminals`
  - `feishu`
  - `whatsapp`

### Channels

- `feishu` 已重构为 plugin：
  - SDK 与连接逻辑放在 `plugins/feishu/src/inner.ts`
  - 不再依赖 `openintern2` 的 `MessageBus`
  - 入站消息会通过 `EventBus` 发 `message.received`
- `whatsapp` 已重构为 plugin：
  - SDK 与连接逻辑放在 `plugins/whatsapp/src/inner.ts`
  - 首次登录会同时：
    - 在终端打印 QR 字符画
    - 将 PNG 保存到 `.openintern3/whatsapp/qr/latest.png`
  - 认证目录默认：
    - `.openintern3/whatsapp/auth`
  - 媒体目录默认：
    - `.openintern3/whatsapp/media`


## 还没做完

下面这些仍然是未完成项，后续 agent 接手时不要误判为已完成：

- `filesystem` 还没有注册成 capability
- `terminals` 还没有注册成 capability
- `agent` 自身还没有暴露 capability
- `policy` / `isolation` 默认实现还没有接入 invoker 链路
- capability schema 只是基础约束，仍需继续清理所有 provider schema 兼容 OpenAI function calling
- session 目前只有最小持久化，没有 consolidation / 长期记忆 / 外部 memory retrieve
- `AgentSessionStore.listKeys()` 目前主要依赖内存 cache，没有做完整目录扫描
- CLI 体验还只是最小可用，不是完整 opencode 级交互
- 还没有把 `openintern2` 的 workflow / subagent / memory / trace 正式迁移进 capability-first 架构
- `whatsapp` 已能接入 agent 自动回复，但还没有：
  - 白名单 chatId
  - 运行时动态开关
  - 更细粒度审批 / policy
- `feishu` 当前已完成 plugin 化与 capability 化，但还没有接入 agent 自动回复


## 注意事项

- 不要重新引入 `tools()` 抽象
- 新能力优先定义成 capability provider
- capability 实现优先放在对应 plugin 自己的目录下，而不是内核目录
- channel 类能力优先通过 plugin 自己的 `inner.ts` 承载 SDK/连接细节
- 如果 provider schema 包含：
  - `type: "array"`，必须补 `items`
  - `type: "object"`，应显式补 `properties`
- 修改 `agent` 时，优先保持：
  - session 在 plugin 内管理
  - CLI 不维护 history
  - capability 调用通过 invoker 发生
