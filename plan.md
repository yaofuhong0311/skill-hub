# 实施计划 — skill-kanban v1

- [x] 1. 安装 Rust 工具链（rustup，一次性）
- [x] 2. 脚手架：create-tauri-app（react-ts 模板）
- [x] 3. subagent 分析全量 skill → 生成 categories.json + templates.json（79 个 skill / 7 分类）
- [x] 4. Rust command：scan_skills / read_skill_tree / read_skill_file / load_config / save_categories
- [x] 5. 前端：侧栏（分类+计数+搜索）→ 卡片网格（来源badge）→ 详情页（描述/目录树/文件预览/模板复制）
- [x] 6. 分类规则兜底 + 未分类手动指定（写回用户配置）
- [x] 7. 验证：tsc 通过 + cargo test 4/4（frontmatter 解析 ×3 + 真实目录扫描）
- [x] 8. tauri build 出 dmg
- [x] 9. v2：UI 重做（用户打回）+ summaries.json 一句话简介 + 插件多版本去重 + frontmatter 剥离
- [x] 10. v3：占位符填写实时替换 + 文件编辑保存回源文件（write_skill_file）
- [x] 11. v4：扫描 ~/.agents/skills + ~/.codex/skills（badge 区分）；配置合并语义 + 「补全配置 Prompt」分发方案；skills.sh 找类似跳转；内置配置补至 110 条
- [x] 12. v4.1：找类似改用 frontmatter name；补全按钮常驻状态位；应用内语义找类似（search_similar + 弹层，端到端验证通过）
