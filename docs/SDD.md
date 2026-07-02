# SDD — Skill 看板（skill-kanban）

macOS 桌面应用：本地 Claude Code skill 的可视化看板。左侧分类导航，右侧 skill 卡片，支持预览能力、查看目录结构、一键复制 prompt 模板。

## 技术选型

| 项 | 决策 | 理由 |
|---|---|---|
| 壳 | Tauri 2 | dmg ~10MB，同类项目 opcode 同款；读本地文件走 Rust command |
| 前端 | React 19 + TypeScript + Vite | create-tauri-app 默认模板，社区惯例 |
| 数据 | 无数据库，每次启动/刷新实时扫描文件系统 | 用户明确要求动态读取 |
| Markdown 渲染 | react-markdown | 详情页展示 SKILL.md 及目录内文件 |

## 数据来源（实时扫描）

- `~/.claude/skills/*/SKILL.md` → 来源 `personal`
- `~/.claude/plugins/cache/**/skills/*/SKILL.md` → 来源 `plugin`（附插件名）
- 解析 frontmatter：`name`、`description`

## 分类机制（三层兜底）

1. **预生成映射**：`categories.json`（skill 名 → 分类），由 AI 分析全量 skill 生成，随应用内置
2. **规则兜底**：新 skill 未命中映射时按规则归类（名称前缀 `golang-*`→Go 开发、`lark-*`→办公协作；描述关键词）
3. **未分类**：规则也未命中 → 「未分类」，界面可手动指定分类，写回用户配置

配置文件位置：`~/Library/Application Support/skill-kanban/`，首次运行从应用内置资源复制，用户可手改。

## Prompt 模板

- `templates.json`：每个 skill 一条针对性模板，带 `{占位符}`，预生成、可手改
- 无模板的 skill 用通用格式兜底：`请使用 {skill名} skill：{description 摘要}。我的任务：___`
- 交付方式：点击复制到剪贴板

## 模块边界

- **Rust 侧（src-tauri）**：只做文件系统 IO，暴露 3 个 command：
  - `scan_skills()` → 全量 skill 元数据列表
  - `read_skill_tree(path)` → 目录树
  - `read_skill_file(path)` → 文件内容（限制在 skill 目录内，防路径穿越）
- **前端**：分类侧栏（含计数+搜索）、卡片网格（来源 badge）、详情页（描述 + 目录树 + 文件预览 + 模板复制）
- **配置**：categories.json / templates.json / rules（内置于前端资源，用户覆盖存 Application Support）

## 打包

`npm run tauri build` → dmg。构建依赖：Rust 工具链（rustup 一次性安装）+ Node 22。

## 扩展扫描与分发（v4）

- 扫描根扩为 4 个：`~/.claude/skills`（personal）、`~/.claude/plugins/cache`（plugin）、`~/.agents/skills`（agents，跨平台 Agent Skills 中央库）、`~/.codex/skills`（codex）；读写白名单同步扩大
- 配置加载改为**合并语义**：内置默认 + 用户配置按条目合并（用户优先），支持增量补全
- 分发方案：应用检测缺配置的 skill →「补全配置 Prompt」按钮生成 prompt → 接收方粘到自己的 Claude Code 生成三份 JSON 到用户配置目录 → 重新扫描生效（零 API key）
- 详情页「skills.sh 找类似」：应用内语义搜索。Rust command `search_similar(query)`（ureq，10s 超时）调 `https://www.skills.sh/api/search?q=`（官方托管、searchType=semantic，中文 query 可用），查询串 = name + description 前 300 字；弹层展示 top8（名称/仓库/安装量），点行跳 `skills.sh/<id>`，底部保留浏览器搜索页入口。走 Rust 发请求是为避开 webview CORS

## Changelog

- 2026-07-02 初版：需求brainstorm后建档，确定 Tauri 2 + 实时扫描 + 三层分类 + 预生成模板库
- 2026-07-02 v2（用户打回 v1 UI 后）：
  - 新增 `summaries.json`（79 条一句话中文简介）——SKILL.md 的 description 面向模型路由，不适合给人看，卡片只展示简介；为什么：用户反馈"看不出 skill 是干啥的"
  - 插件多版本去重：同 (plugin, skill) 只保留版本最新的一份（v1 把 superpowers 4.3.1/6.1.0 重复计入，79 变 95）
  - UI 重做：参考 skills-manage/opcode 布局——侧栏计数胶囊+分区标签、内容区页头（分类名+数量+重新扫描）、双列大卡片、留白加大
  - 详情页 markdown 预览剥离 frontmatter（否则被渲染成 setext 大标题）
- 2026-07-02 v3（用户追加需求）：
  - 占位符填写：解析模板中 `{占位符}` 生成输入框，实时替换进 prompt 并高亮，复制即得可直接用的完整 prompt；为什么：用户要"填参数→直接复制可用"
  - 新增 Rust command `write_skill_file(path, content)`：详情页文件预览支持「编辑→保存」，直接写回真实 skill 源文件；护栏：仅允许白名单目录内已存在的文件（canonicalize 防路径穿越），有单测覆盖
- 2026-07-02 v4（用户三问：Codex 能扫吗 / 发别人怎么分类 / skills.sh 找类似）：
  - 见「扩展扫描与分发」节；config/*.json 由 subagent 补至 110 条（新增 agents 库 31 个，新分类 research-info 资讯与研究）
- 2026-07-02 v5 改名 skill-hub（用户指出英文 kanban 特指敏捷任务板，语义不符）：
  - 改动：仓库/产品名/identifier/Cargo 包名 → skill-hub；UI 标题 → Skill Hub；用户配置目录 → `~/Library/Application Support/skill-hub/`（启动时自动迁移旧 skill-kanban 目录）；文中旧路径以本条为准
  - 同时修正（用户指出）：补全配置 prompt 并不依赖 Claude Code，README 和应用内文案改为"任意 AI 编程助手（Claude Code / Codex / Cursor 等）"
- 2026-07-02 v4.1（用户反馈修正）：
  - 「找类似」搜索词从目录名改为 frontmatter name（目录 2nd-brain / name brain 不一致导致搜空）
  - 「补全配置 Prompt」按钮改常驻状态位：齐全时显示「✓ 分类/简介/模板已齐全」，有缺口才变按钮（原来直接隐藏，用户找不到）
  - 「找类似」升级为应用内语义搜索（新增依赖 ureq；新 command search_similar）
