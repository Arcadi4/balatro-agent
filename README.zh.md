<div align="center">

# Balatro MCP

<!-- README-I18N:START -->

[English](./README.md) | **简体中文**

<!-- README-I18N:END -->

[![Node.js](https://img.shields.io/badge/Node.js-%3E%3D18-3c873a?style=flat-square)](https://nodejs.org) [![TypeScript](https://img.shields.io/badge/TypeScript-6.x-blue?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org) [![MCP](https://img.shields.io/badge/MCP-Server-111827?style=flat-square)](https://modelcontextprotocol.io) [![SMODS](https://img.shields.io/badge/SMODS-Powered-8a2be2?style=flat-square)](https://github.com/Steamodded/smods)

</div>

Balatro MCP 将 TypeScript MCP 服务器与 Steamodded/Lovely Balatro Mod 配对，让智能体可以通过完全基于文本的接口观察实时游戏状态并与 Balatro 交互。不需要视觉模型，也不需要屏幕抓取。

> [!WARNING]
> 本项目目前仅针对 macOS Apple Silicon 配置并测试。未来会加入更通用的安装支持。

## 功能

- **实时游戏观察**：通过 `balatro_inspect_game_state` 获取阶段、手牌、Joker、商店、盲注、牌库摘要、合法动作与规则元数据。
- **类型化游戏动作**：支持盲注、手牌选择、出牌/弃牌、购买、补充包、商店流程、消耗牌、出售与 Joker 重排。
- **文本优先的智能体控制**：模型可以基于结构化状态推理，而不是依赖截图。
- **游戏知识表面**：包含规则资源、策略 prompt 与实体参考。

## 通信架构

```text
Agent / MCP client
        |
        | stdio MCP
        v
mcp/dist/index.js
(will release a npm package
later for the ease of installation)
        |
        | JSON commands, responses, state snapshots
        v
~/Library/Application Support/Balatro/Mods/balatro_mcp/bridge/
(a socket or HTTP server is considered for
performance and reliability in the future.)
        |
        | love.update hook
        v
Balatro + Lovely + SMODS + balatro_mcp mod
```

## 要求

- 通过 Steam 安装 Balatro。
- [Lovely Injector](https://github.com/ethangreen-dev/lovely-injector)。
- [Steamodded / SMODS](https://github.com/Steamodded/smods)。
- Node.js 18 或更高版本。
- pnpm。
- 可用的 Lua 工具链，并能运行 `luac` 做语法检查。

## 快速开始

请在仓库根目录使用 `make` 管理本地开发流程：

| 命令 | 说明 |
| --- | --- |
| `make doctor` | 检查本机 Balatro、Lovely 与 SMODS 路径。 |
| `make install-mods` | 将仓库内的 Mod 同步到 `~/Library/Application Support/Balatro/Mods`。 |
| `make run` | 同步仓库内的 Mod，然后通过 Lovely 启动 Balatro。 |

需要时可以覆盖本地路径，例如：

```sh
make doctor BALATRO_DIR="/path/to/Balatro" BALATRO_SAVE="/path/to/Balatro/save"
```

请在 `mcp/` 中构建 MCP 服务器，然后将 MCP 客户端配置为启动 `mcp/dist/index.js`。

## 使用 MCP 服务器

服务器暴露带有 `balatro_` 前缀的工具，包括：

| 范围 | 工具 |
| --- | --- |
| 状态 | `balatro_inspect_game_state` |
| 盲注 | `balatro_select_blind`, `balatro_skip_blind` |
| 手牌行动 | `balatro_select_hand_cards`, `balatro_sort_hand`, `balatro_play_hand`, `balatro_discard_hand` |
| 商店 | `balatro_buy_card`, `balatro_buy_and_use_card`, `balatro_reroll_shop`, `balatro_leave_shop`, `balatro_cash_out` |
| 卡牌 | `balatro_use_consumable`, `balatro_sell_card`, `balatro_reorder_jokers` |
| 补充包 | `balatro_open_booster`, `balatro_select_booster_card`, `balatro_skip_booster` |
| 知识 | `balatro_list_game_entities`, `balatro_read_entity_wiki`, `balatro_inspect_card_instance` |

它还注册了：

- `balatro://rules/global` 静态规则资源。
- `balatro_strategy_context` 策略 prompt。

## 验证

修改 MCP 服务器或配套 Mod 时，请针对你的 checkout 运行相应的 TypeScript 和 Lua 检查。修改 Balatro Mod 后，请运行 `make install-mods`，重新加载 Balatro，并通过 MCP 工具验证行为，而不只是阅读代码。

## 故障排查

### MCP 工具返回 `GAME_NOT_RUNNING`

确认 Balatro 正在运行且配套 Mod 已加载，然后确认 MCP 客户端可以成功启动已构建的服务器。

### Balatro 没有反映 Mod 变更

更新已安装的配套 Mod 后，请重新加载或重启 Balatro。Lua 文件由游戏运行时加载，而不是由 MCP 服务器进程加载。

### MCP 服务器无法启动

启动服务器前请先构建 MCP 服务器。如果客户端启动的是旧构建，请重新构建并重启 MCP 会话。

## 参考资料

- [Model Context Protocol](https://modelcontextprotocol.io)
- [Lovely Injector](https://github.com/ethangreen-dev/lovely-injector)
- [Steamodded / SMODS](https://github.com/Steamodded/smods)
- [SMODS wiki](https://github.com/Steamodded/smods/wiki)
