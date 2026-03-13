# Service Layer

`src/service/` 定义的是 microkernel 的基础设施接口，而不是具体业务能力。

这一层负责回答四个问题：

- 如何发现能力
- 如何调用能力
- 如何控制权限
- 如何施加隔离

当前约定分为四类 service：

## Capability Registry

- `registry` 负责发现
- 维护 capability 的注册、注销、查询、枚举
- 不负责执行能力

对应接口：

- `CapabilityRegistryServiceProvider`

## Capability Invoker

- `invoker` 负责调用
- 根据 `capabilityId` 执行某个 capability
- 是 kernel 内部统一调用入口

对应接口：

- `CapabilityInvokerServiceProvider`

## Capability Policy

- `policy` 负责授权
- 判断某个调用上下文是否允许访问某个 capability
- 用于最小权限控制，而不是承载业务逻辑

对应接口：

- `CapabilityPolicyServiceProvider`

## Capability Isolation

- `isolation` 负责隔离
- 在 capability 调用前后施加隔离边界
- 可用于输入裁剪、上下文净化、资源限制、沙箱路由等

对应接口：

- `CapabilityIsolationServiceProvider`

## Design Notes

- capability 是第一公民，agent 不是第一公民
- service 是 capability 的基础设施，不是 capability 本身
- plugin 之间应优先通过 capability + service 协作，而不是直接互相引用实现
- 分类优先体现在 descriptor 和 policy 上，而不是过早固化为继承层级
