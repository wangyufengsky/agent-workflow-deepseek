# OpenCode Go flash 兼容网关（tool_choice）

> 状态：已实现并默认启用；target 环境只部署 `opencode-go/deepseek-v4.1-flash`。
> 验证：真实 provider + 真实 MCP 工具 + 真实 Git worktree（规划与执行各一条 live e2e）。

## 问题

OpenCode 1.19.0 在会话里存在工具时会向前端 provider 发送 `tool_choice`。本机实测请求体（拦截到真实出站请求）：

```json
{
  "model": "deepseek-v4.1-flash",
  "stream": true,
  "tool_choice": "auto",
  "tools": ["agent-workflow_ping", "bash", "edit", "glob", "grep", "read", "..."]
}
```

而 OpenCode Go 的 `deepseek-v4.1-flash` 在 thinking 模式下，上游会拒绝**任何** tool_choice（包括 `auto`）：

```
AI_APICallError: Upstream request failed: [invalid_request_error]
Thinking mode does not support this tool_choice
```

因此只要注入 MCP 工具，规划/执行就会失败；不带工具的普通对话则正常。

## 已排除的方案

| 方案 | 实测结果 |
| --- | --- |
| 模型配置 `reasoning: false` | 出站请求无变化，仍失败 |
| 模型 options `thinking: {type:"disabled"}` | 出站请求无变化，仍失败 |
| `reasoningEffort: "none"` | 出站请求无变化，仍失败 |
| prompt 里加软要求 | 改不了 API 层参数，仍失败 |
| 仅用 prompt 输出 JSON（完全禁用工具） | 可运行 flash，但失去 MCP 工具结果/错误码与文件写入能力，仅作最后降级 |

## 方案：本地 provider 兼容网关

```
OpenCode ──OpenAI 兼容请求──▶ http://127.0.0.1:<app>/api/opencode/gateway/<secret>/v1
                                      │ 删除 model=flash 且带工具时的 tool_choice
                                      ▼
                             https://opencode.ai/inference/go/openai/v1
```

- 实现：[`packages/server/src/opencode-gateway.ts`](../packages/server/src/opencode-gateway.ts)
- 生成配置时把 `provider.opencode-go.options.baseURL` 指向网关（`OpenCodeAdapter.providerOverrides`）。
- 只归一化 `tool_choice`，Authorization、`x-opencode-org-id`、SSE、错误体原样透传。
- 网关只监听应用本身的回环 HTTP 服务；每次启动生成随机路径 secret。
- 日志：`<dataDir>/logs/provider-gateway.jsonl`，只记录模型、工具数、是否归一化、状态、耗时；**不记录 prompt、消息内容或凭据**。
- 配置：
  ```json
  {
    "opencode": {
      "providerGateway": {
        "enabled": true,
        "upstreamBaseUrl": "https://opencode.ai/inference/go/openai/v1",
        "stripToolChoiceForModels": ["deepseek-v4.1-flash"],
        "requestTimeoutMs": 600000
      }
    }
  }
  ```

## 验证

| 场景 | 结果 |
| --- | --- |
| flash + MCP 工具（dummy `ping`） | 工具真实被调用，无 APIError |
| flash 规划（真实 provider、真实 MCP 提交） | 候选通过结构检查（0 problems）→ 应用 → 确认计划 → worktree 准备成功 |
| flash 执行（MCP 文件写入 + result.submit） | 节点成功，worktree 中 `README.md` 有真实改动 |
| 全量测试 | 238 tests / 235 pass / 3 skip |

## 风险与切换

- 这是针对上游 thinking 模式限制的**本地兼容层**，不是改 OpenCode 源码；上游修复后可关闭。
- 如果 target 环境只能走某个内部 OpenAI 兼容 API：provider 本身与 MCP 注入无关，只需配置 `baseURL/apiKey/model`；
  若该 API 没有 tool_choice 限制，可关闭网关。
- 若某个模型确实不支持工具调用，可把该模型标记为“无工具模式”，规划改用 prompt JSON 协议（后续可选能力）。
