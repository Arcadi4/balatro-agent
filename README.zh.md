<div align="center">

# Balatro Agent

<!-- README-I18N:START -->

[English](./README.md) | **简体中文**

<!-- README-I18N:END -->

[![Bun](https://img.shields.io/badge/Bun-%3E%3D1.3.14-f9f1e1?style=flat-square&logo=bun&logoColor=black)](https://bun.sh) [![TypeScript](https://img.shields.io/badge/TypeScript-7.x-blue?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org) [![MCP](https://img.shields.io/badge/MCP-2026--07--28-111827?style=flat-square)](https://modelcontextprotocol.io) [![SMODS](https://img.shields.io/badge/SMODS-Powered-8a2be2?style=flat-square)](https://github.com/Steamodded/smods)

</div>

Balatro Agent 让你把兼容 MCP 的 AI 智能体连接到 Balatro。智能体读取实时游戏状态并替你游玩。它可以选择盲注、出牌和弃牌、购买和使用卡牌、刷新商店、调整小丑牌顺序。基于纯文本接口，完全不依赖模型视觉。

## 工作原理

项目包含两个组件：

- `mcp/` 中的 Bun MCP 服务器。由你的 MCP 客户端启动，通过 stdio 通信。
- `mods/balatro_mcp/` 中的 Steamodded Mod。它在 Balatro 内部运行并执行游戏操作。

服务器与 Mod 通过换行分隔的 JSON-RPC 2.0 通信：

```text
MCP 客户端 ── stdio ──> Bun 服务器 ── JSON-RPC 2.0 / NDJSON ──> Balatro Mod
                                  Unix socket（macOS/Linux）
                                  命名管道（Windows）
```

## 准备工作

- Steam 版 Balatro
- [Lovely Injector](https://github.com/ethangreen-dev/lovely-injector)
- [Steamodded（SMODS）](https://github.com/Steamodded/smods)
- [Bun](https://bun.sh) 1.3.14 或更高版本

## 开始使用

1. 安装 Lovely Injector 和 Steamodded。
2. 将 `mods/balatro_mcp` 复制到 Balatro 的 `Mods` 目录，完成 Mod 安装。
   - 在 macOS 上，于仓库根目录运行 `make install-mods`。
   - 在 Windows 上，将该目录复制到 `%AppData%\Balatro\Mods\balatro_mcp`。
3. 安装服务器依赖并验证源码：

   ```sh
   cd mcp
   bun install
   bun run typecheck
   ```

4. 将服务器添加到你的 MCP 客户端配置中：

   ```json
   {
     "mcpServers": {
       "balatro": {
         "command": "bun",
         "args": ["/absolute/path/to/balatro-mcp/mcp/src/index.ts"]
       }
     }
   }
   ```

5. 启用 Mod 并启动 Balatro。
6. 启动你的 MCP 客户端，让智能体开始游玩。例如："检查游戏状态，然后打下一个盲注。"

## 更改桥接端点

服务器和 Mod 默认在 macOS 和 Linux 上通过 `/tmp/balatro-mcp.sock`、在 Windows 上通过 `\\.\pipe\balatro-mcp` 互相连接。如需使用其他端点，请在两个进程中将 `BALATRO_BRIDGE_SOCKET` 设置为同一个值。

## 智能体可以做什么

智能体有 25 个工具可用。

| 范围 | 工具 |
| --- | --- |
| 检查游戏 | `balatro_inspect_game_state`, `balatro_inspect_card_instance` |
| 盲注 | `balatro_select_blind`, `balatro_skip_blind` |
| 手牌 | `balatro_select_hand_cards`, `balatro_sort_hand`, `balatro_play_hand`, `balatro_discard_hand` |
| 商店 | `balatro_buy_card`, `balatro_buy_consumable`, `balatro_buy_voucher`, `balatro_buy_booster`, `balatro_reroll_shop`, `balatro_leave_shop`, `balatro_cash_out` |
| 卡牌 | `balatro_use_consumable`, `balatro_sell_card`, `balatro_reorder_jokers` |
| 补充包 | `balatro_select_booster_card`, `balatro_skip_booster` |
| 游戏控制 | `balatro_new_game`, `balatro_continue_game`, `balatro_restart` |
| 游戏知识 | `balatro_list_game_entities`, `balatro_read_wiki` |

智能体还会通过 `balatro://rules/global` 资源和 `balatro_strategy_context` prompt 获得 Balatro 的静态规则，无需查阅外部文档即可做出决策。

四个经过实机测试的 OpenCode 智能体提示词版本及脱敏汇总证据位于 [`examples/opencode/agents`](examples/opencode/agents/README.md)。

## 故障排除

- **智能体无法连接游戏。** 确认 Balatro 正在运行且 Mod 已启用，然后重启 MCP 客户端。
- **你修改了 Mod。** 重新安装 Mod 并重启 Balatro。Mod 只在启动时加载。
- **第二个客户端无法连接。** 桥接同时只接受一个客户端。停止另一个客户端后重试。

## 开发

开发仅在 macOS Apple Silicon 上测试。`make` 目标仅适用于 macOS。修改后请验证两份源码：

```sh
cd mcp
bun run typecheck
bun run build
find ../mods/balatro_mcp -name '*.lua' -print0 | xargs -0 -n1 luac -p
```

## 参考资料

- [Model Context Protocol](https://modelcontextprotocol.io/docs/2026-07-28)
- [Bun 文档](https://bun.sh/docs)
- [Lovely Injector](https://github.com/ethangreen-dev/lovely-injector)
- [Steamodded（SMODS）](https://github.com/Steamodded/smods)
