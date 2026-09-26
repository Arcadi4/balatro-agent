<div align="center">

# Balatro Agent

<!-- README-I18N:START -->

[English](./README.md) | **简体中文**

<!-- README-I18N:END -->

[![npm](https://img.shields.io/npm/v/balatro-mcp?style=flat-square)](https://www.npmjs.com/package/balatro-mcp) [![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-3c873a?style=flat-square)](https://nodejs.org) [![Bun](https://img.shields.io/badge/Bun-1.4.2-f9f1e1?style=flat-square&logo=bun)](https://bun.sh) [![TypeScript](https://img.shields.io/badge/TypeScript-7.x-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org) [![MCP](https://img.shields.io/badge/MCP-2026--07--28-111827?style=flat-square)](https://modelcontextprotocol.io) [![SMODS](https://img.shields.io/badge/SMODS-Powered-8a2be2?style=flat-square)](https://github.com/Steamodded/smods)

</div>

让 AI 也能玩小丑牌。Balatro Agent 可将任何兼容 MCP 的 AI 客户端接入运行中的游戏。智能体可以读取实时状态、选盲注、出牌弃牌、购买小丑牌，并执行人类玩家的操作。无需截屏或视觉模型，所有操作都通过文本工具调用完成。

<https://github.com/user-attachments/assets/bcb40bd1-a9f8-491c-9a98-6f1a11c90fab>

> [!IMPORTANT]
> Balatro v1.1 即将发布，我会争取尽快提供支持。之后的版本将不再保证兼容 v1.0 版游戏。

## 准备工作

- Steam 版 [Balatro](https://store.steampowered.com/app/2379780/Balatro/)
- [Lovely Injector](https://github.com/ethangreen-dev/lovely-injector)
- [Steamodded（SMODS）](https://github.com/Steamodded/smods)
- [Node.js](https://nodejs.org) 20 或更高版本，用于 npx（启动原生 MCP 可执行文件，无需安装 Bun、克隆仓库或手动构建）。GitHub Releases 中的原生程序也可直接运行，无需 Node。

## 安装

### 1. 安装 Lovely 和 SMODS

按照 [SMODS 安装指南](https://github.com/Steamodded/smods/wiki)完成对应平台的安装。所有 Balatro Mod 都是这一步。

### 2. 安装 Balatro Agent Mod

下载并解压 Mod 到 Balatro 的 `Mods` 目录：

- [Nexus Mods 页面](https://www.nexusmods.com/balatro/mods/927)：手动下载，或配合[社区 Vortex 扩展](https://www.nexusmods.com/site/mods/1315)使用"Mod Manager Download"，它还能帮你自动安装 Lovely 和 Steamodded。
- [GitHub Releases](https://github.com/Arcadi4/balatro-agent/releases/latest)：从最新发布版下载 `balatro-agent-vX.Y.Z.zip`。

| 平台 | Mods 目录 |
| --- | --- |
| macOS | `~/Library/Application Support/Balatro/Mods/` |
| Windows | `%AppData%\Balatro\Mods\` |
| Linux（原生） | `~/.local/share/love/Balatro/Mods/` |
| Linux（Proton） | `~/.steam/steam/steamapps/compatdata/2379780/pfx/drive_c/users/steamuser/AppData/Roaming/Balatro/Mods/` |

> [!TIP]
> 在 macOS 上，也可以克隆并在仓库根目录运行 `make install-mods`，不用手动复制。

最终路径应该是 `.../Balatro/Mods/balatro-agent/main.lua`。

### 3. 接入 MCP

把 MCP 服务器加进你的 Agent 客户端配置（Claude Code、Cursor 等），请查阅对应文档/教程。配置文件可能类似：

```json
{
  "mcpServers": {
    "balatro": {
      "command": "npx",
      "args": ["-y", "balatro-mcp"]
    }
  }
}
```

完整命令：

```bash
npx -y balatro-mcp
```

## 开始游玩

1. 启用 Mod 并启动 Balatro。
2. 启动 MCP 客户端。
3. 让智能体开打，比如：

   > 用红色牌组（Red Deck）开一局新游戏，打完第一底注。

## 功能

- 选择或跳过盲注、出牌和弃牌、整理和选择手牌
- 在商店购买小丑、消耗牌、优惠券和补充包，刷新商店、结算收益
- 使用和出售卡牌，调整小丑顺序以优化触发次序
- 用任意牌组、赌注或挑战开始、继续、重开一局游戏
- 内置 Balatro 手册和参考数据，并可实时查询 Balatro Wiki 上的卡牌、盲注和机制说明

> [!IMPORTANT]
> 实时游戏状态和 Wiki 都通过 [MCP 资源](https://modelcontextprotocol.io/specification/2026-07-28/server/resources) 提供。如果客户端没有完整支持资源功能，Agent 可能无法读取当前游戏状态或 Wiki 内容。
