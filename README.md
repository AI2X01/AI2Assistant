# AI2Assistant (智能事项与碎片信息助手)

> 基于 **Tauri 2.0 (Rust) + SQLite + React 18 + Tailwind CSS** 构建的轻量级、非阻断式桌面 AI 伴侣。

---

## 🌟 核心价值与功能亮点

1. **系统级划选无感捕获 (Safe Clipboard Round-trip)**：
   - 在任何应用（微信、企业微信、飞书、钉钉、浏览器等）中划选文字，按下全局热键 `Alt + A`；
   - 采用 Win32 API 毫秒级快照备份剪贴板，虚拟击键提取文本后立即恢复原剪贴板，**绝对不覆盖用户原有复制历史**；
   - 自动探测前台进程名（如微信）与窗口标题（如项目群聊），保留完整的上下文来源。

2. **AI 智能语义路由与增量沉淀 (Intent Routing & Fact Extraction)**：
   - **高置信度自动归档**：AI 自动比对当前进行中的事项，自动沉淀至时间轴日志、增量提炼事实摘要、提取待办；
   - **低置信度微窗盲操**：右下角弹出极简 HUD 微窗，提供候选事项，单手按数字键 `1` / `2` / `3` 即可快速归档；
   - **全新事项建议**：自动提炼事项标题与类别，回车即创建；
   - **离线规则引擎降级**：未配置 API Key 时自动启用基于时间实体与关键词的本地离线规则引擎，免配置即开即用。

3. **双视图高效工作台 (Kanban & Master Todos)**：
   - **事项卡片看板**：多维状态过滤（进行中/挂起/已完成/已归档）、类别过滤（工作/生活）、置顶与多维排序；
   - **事项详情与时间轴抽屉**：垂直时间轴倒序回溯碎片来源、核心事实沉淀卡（支持手动编辑与 AI 重新提炼）、日志一键转待办；
   - **待办全景与今日聚焦 (Focus Mode)**：置顶攻坚关键待办，按时间维度自动切片（已逾期、今天、近期、待定）；
   - **本地原生定时提醒**：后台定时调度，到期触发 Windows 系统原生 Toast 通知。

---

## ⌨️ 默认快捷键

| 快捷键 | 功能 | 说明 |
| :--- | :--- | :--- |
| `Alt + A` | **划选捕获与 AI 意图路由** | 划选文字后按下，自动唤起 HUD 微窗 |
| `1` / `2` / `3` | **HUD 单键选择候选事项** | 微窗处于歧义候选态时单键盲操 |
| `Enter` | **HUD 确认创建推荐新事项** | 微窗处于新建事项态时一键确认 |
| `Esc` | **HUD 忽略并立即收起** | 快速退出微窗，不打断手头工作 |
| `Alt + Shift + Space` | **呼出 / 隐藏主看板窗口** | 快速调出主工作台 |

---

## 🛠️ 项目结构

```
AI2Assistant/
├── PRD/                           # 产品规格与架构设计文档
│   └── V0.1/
│       ├── SPEC.md                # 原始需求记录
│       ├── PRD_V0.1.md            # 详细产品需求说明书
│       ├── IA_AND_INTERACTION.md  # 信息架构与交互设计说明书
│       ├── SYSTEM_ARCHITECTURE_V0.1.md # 系统架构与概要设计
│       └── DEVELOPMENT_PLAN_V0.1.md    # 研发排期与工作分解表
│
├── src-tauri/                     # Tauri 2.0 / Rust 后端
│   ├── src/
│   │   ├── db.rs                  # SQLite 关系数据库 (WAL模式, 完整CRUD及单元测试)
│   │   ├── models.rs              # 数据实体模型 (Matter, LogItem, TodoItem, AppConfig)
│   │   ├── services/
│   │   │   ├── clipboard_service.rs # 剪贴板安全捕获与还原、前台活动窗口探测
│   │   │   ├── ai_service.rs        # 大模型 Prompt 编排、JSON校验与离线规则降级引擎
│   │   │   └── reminder_service.rs  # 本地后台待办到期调度与系统原生通知
│   │   ├── commands.rs            # 全部 Tauri IPC 接口封装
│   │   └── lib.rs                 # 生命周期、双窗口布局、系统托盘、全局快捷键
│   ├── Cargo.toml
│   └── tauri.conf.json            # Tauri 配置 (包含 main 主窗口与 hud 微窗)
│
└── src/                           # React 18 + Vite + Tailwind 前端
    ├── components/
    │   ├── Navbar.tsx             # 顶部全局导航与搜索
    │   ├── MatterCard.tsx         # 事项看板卡片
    │   ├── MatterDrawer.tsx       # 事项详情抽屉、时间轴、事实沉淀与待办
    │   ├── TodoBoard.tsx          # 待办全景视图与今日聚焦
    │   ├── HUDWindow.tsx          # 桌面右下角极简非阻断微窗
    │   ├── NewMatterModal.tsx     # 新建事项对话框
    │   └── SettingsModal.tsx      # 大模型与系统设置中心
    ├── services/
    │   └── api.ts                 # Tauri IPC 接口调用与浏览器 Mock 自动适配
    ├── types/
    │   └── index.ts               # TypeScript 完整类型定义
    └── App.tsx                    # 窗口路由分发与全局状态编排
```

---

## 🚀 启动与开发指南

### 1. 前置依赖
- [Node.js](https://nodejs.org/) (>= 18) 与 [pnpm](https://pnpm.io/)
- [Rust](https://www.rust-lang.org/) (Cargo >= 1.75)
- Windows 10/11 系统环境

### 2. 运行开发环境
```bash
# 安装前端依赖
pnpm install

# 仅在浏览器中预览开发（自动启用完备的 Mock 数据）
pnpm dev

# 启动完整的 Tauri 桌面开发模式
pnpm tauri dev
```

### 3. 构建与打包
```bash
# 前端类型检查与打包构建
pnpm build

# 运行 Rust 核心单元测试套件
cargo test --manifest-path src-tauri/Cargo.toml

# 编译生成 Windows 桌面可执行程序
cargo build --manifest-path src-tauri/Cargo.toml
# 生成的产物位于: src-tauri/target/debug/ai2assistant.exe
```
