<div align="center">

# Balatro Agent

<!-- README-I18N:START -->

[English](./README.md) | **简体中文**

<!-- README-I18N:END -->

[![Bun](https://img.shields.io/badge/Bun-%3E%3D1.3.14-f9f1e1?style=flat-square&logo=bun&logoColor=black)](https://bun.sh) [![TypeScript](https://img.shields.io/badge/TypeScript-7.x-blue?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org) [![MCP](https://img.shields.io/badge/MCP-2026--07--28-111827?style=flat-square)](https://modelcontextprotocol.io) [![SMODS](https://img.shields.io/badge/SMODS-Powered-8a2be2?style=flat-square)](https://github.com/Steamodded/smods)

</div>

Balatro Agent 将 Bun MCP 服务器与 Steamodded/Lovely Mod 组合起来。智能体无需截图或屏幕抓取，即可读取结构化游戏状态并调用类型化操作。

运行时桥接在 macOS/Linux 上使用 Unix socket，在 Windows 上使用命名管道。目前仅在 macOS Apple Silicon 上做过本地测试；仓库根目录的 `make` 开发流程仍仅适用于 macOS。

## 架构

```text
MCP 客户端 ── stdio ──> Bun 服务器 ── JSON-RPC 2.0 / NDJSON ──> Balatro Mod
                                  Unix socket（macOS/Linux）
                                  命名管道（Windows）
```

macOS/Linux 的默认端点为 `/tmp/balatro-mcp.sock`，Windows 为 `\\.\pipe\balatro-mcp`。如需覆盖，请为两个进程设置同一个 `BALATRO_BRIDGE_SOCKET`。

## 要求

- Steam 版 Balatro
- [Lovely Injector](https://github.com/ethangreen-dev/lovely-injector)
- [Steamodded / SMODS](https://github.com/Steamodded/smods)
- [Bun](https://bun.sh) 1.3.14 或更高版本
- 用于 Lua 语法验证的 `luac`

## 安装

安装服务器依赖并验证源码：

```sh
cd mcp
bun install
bun run typecheck
bun run build
```

将 `mods/balatro_mcp` 安装到 Balatro 的 `Mods` 目录：

- macOS 开发 checkout：`make install-mods`
- Windows：复制到 `%AppData%\Balatro\Mods\balatro_mcp`

启用 Mod 并启动 Balatro，然后配置 MCP 客户端直接运行 TypeScript 源码：

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

打包并非必需；`bun run build` 会生成 `mcp/dist/index.js`。

## MCP 接口

服务器提供 22 个工具：

| 范围 | 工具 |
| --- | --- |
| 状态 | `balatro_inspect_game_state`, `balatro_inspect_card_instance` |
| 盲注 | `balatro_select_blind`, `balatro_skip_blind` |
| 手牌 | `balatro_select_hand_cards`, `balatro_sort_hand`, `balatro_play_hand`, `balatro_discard_hand` |
| 商店 | `balatro_buy_card`, `balatro_buy_consumable`, `balatro_buy_voucher`, `balatro_buy_booster`, `balatro_reroll_shop`, `balatro_leave_shop`, `balatro_cash_out` |
| 卡牌 | `balatro_use_consumable`, `balatro_sell_card`, `balatro_reorder_jokers` |
| 补充包 | `balatro_select_booster_card`, `balatro_skip_booster` |
| 知识 | `balatro_list_game_entities`, `balatro_read_wiki` |

静态规则仅通过 `balatro://rules/global` 资源暴露，并包含在 `balatro_strategy_context` prompt 中。每次操作前都应检查实时状态。

## 开发验证

```sh
cd mcp
bun run typecheck
bun run build
find ../mods/balatro_mcp -name '*.lua' -print0 | xargs -0 -n1 luac -p
```

修改 Mod 后，请重新安装并重启 Balatro，再进行 MCP 手动测试。

## 参考资料

- [Model Context Protocol](https://modelcontextprotocol.io/docs/2026-07-28)
- [Bun 文档](https://bun.sh/docs)
- [Lovely Injector](https://github.com/ethangreen-dev/lovely-injector)
- [Steamodded / SMODS](https://github.com/Steamodded/smods)
