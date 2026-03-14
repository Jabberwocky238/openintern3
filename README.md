# openintern3

`openintern3` 是一个借鉴 microkernel 思想的工作流引擎。

项目目标：

- 把能力统一抽象为 plugin
- 让 kernel 保持足够小，只负责挂载、初始化、信号传递与路由
- 让 workflow 通过 plugin 组合形成，而不是写死在内核中
- 让 agent、终端、文件系统、定时器、渠道能力都能以同一种方式接入

## 核心理念

- 万物皆 plugin
- kernel 不承载业务能力
- plugin 承载状态、能力和具体实现
- plugin 之间优先通过事件和 capability 协作

## 启动

根目录依赖：

```bash
bun install
```

插件本地依赖：

```bash
cd plugins/feishu && bun install
cd ../whatsapp && bun install
cd ../..
```

启动：

```bash
bun run dev
```

## 当前默认加载的 plugin

- `echo`
- `cron`
- `filesystem`
- `agent`
- `terminals`
- `feishu`
- `whatsapp`

查看已加载插件：

```text
/plugin list
```

## 当前 capability

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

## 快速验证

触发 `cron -> echo`：

```text
/plugin cron addCron echo 500
```

预期结果：

- 返回一个 cron id
- `echo` 插件持续打印来自 `cron` 的时间戳 payload

## Agent 当前状态

测试命令：

```text
/plugin agent runPrompt 你好
```

当前进展：

- `agent` 已提供最小 `AgentRunner` 协议
- 已支持 capability tools 组装、tool call 解析与执行
- session 在 plugin 内管理并落盘
- 当前已接入 `whatsapp -> agent -> whatsapp` 自动回复链路

## Filesystem

`filesystem` 已 capability 化，核心实现放在 `plugins/filesystem/src/inner.ts`。

调试示例：

```text
/plugin filesystem inspect .
/plugin filesystem list .
```

## WhatsApp

环境变量最小配置：

```env
WHATSAPP_ENABLED=true
WHATSAPP_AGENT_ENABLED=true
```

可选环境变量：

```env
WHATSAPP_AUTH_DIR=.openintern3/whatsapp/auth
WHATSAPP_MEDIA_DIR=.openintern3/whatsapp/media
```

启动：

```text
/plugin whatsapp start
/plugin wecom start
```

首次登录时会：

- 在终端打印 QR 字符画
- 将二维码 PNG 保存到 `.openintern3/whatsapp/qr/latest.png`

调试命令：

```text
/plugin whatsapp status
/plugin whatsapp pullMessages
```

当 `WHATSAPP_AGENT_ENABLED=true` 时，收到 WhatsApp 消息后会自动：

1. 调 `agent.runSession("whatsapp:<chatId>", message)`
2. 生成回复
3. 回发到原 WhatsApp 会话

## Feishu

当前 `feishu` 已完成 plugin 化，不再依赖 `openintern2` 的 `MessageBus`。

当前能力：

- `feishu.start`
- `feishu.stop`
- `feishu.status`
- `feishu.send_message`
- `feishu.pull_messages`

当前入站消息会通过内核 `EventBus` 发出 `message.received`。

## 类型检查

```bash
./node_modules/.bin/tsc --noEmit
```
