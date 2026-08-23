<div align="center">

# Balatro Agent

<!-- README-I18N:START -->

[English](./README.md) | **简体中文**

<!-- README-I18N:END -->

[![npm](https://img.shields.io/npm/v/balatro-mcp?style=flat-square)](https://www.npmjs.com/package/balatro-mcp) [![Node.js](https://img.shields.io/badge/Node.js-%3E%3D20-3c873a?style=flat-square)](https://nodejs.org) [![Bun](https://img.shields.io/badge/Bun-1.4.0-f9f1e1?style=flat-square&logo=bun)](https://bun.sh) [![TypeScript](https://img.shields.io/badge/TypeScript-7.x-blue?style=flat-square&logo=typescript)](https://www.typescriptlang.org) [![MCP](https://img.shields.io/badge/MCP-2026--07--28-111827?style=flat-square)](https://modelcontextprotocol.io) [![SMODS](https://img.shields.io/badge/SMODS-Powered-8a2be2?style=flat-square)](https://github.com/Steamodded/smods)

</div>

让 AI 替你打 Balatro。Balatro Agent 可以把任何兼容 MCP 的 AI 客户端接入正在运行的游戏：智能体读取实时游戏状态，帮你选盲注、出牌弃牌、逛商店买小丑，管理整局游戏。不需要截屏，也不需要模型视觉，一切基于文本。

## 准备工作

- Steam 版 [Balatro](https://store.steampowered.com/app/2379780/Balatro/)
- [Lovely Injector](https://github.com/ethangreen-dev/lovely-injector)
- [Steamodded（SMODS）](https://github.com/Steamodded/smods)
- [Node.js](https://nodejs.org) 20 或更高版本（MCP 服务器通过 npx 运行，无需克隆仓库或手动构建）

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

复制完成后，路径应该是 `.../Balatro/Mods/balatro-agent/main.lua`。

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

命令：

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
- 内置 Balatro 规则文档，并可实时查询 Balatro Wiki 上的卡牌、盲注和机制说明

> [!IMPORTANT]
> Wiki 读取是通过 [MCP 资源](https://modelcontextprotocol.io/specification/2026-07-28/server/resources)实现的，如果你的 Agent 客户端没有正确支持这个功能，Agent 可能无法顺利获取 Wiki 内容。
