use serde::Serialize;
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Serialize)]
struct SkillMeta {
    /// frontmatter name（缺失时用目录名）
    name: String,
    /// 目录名，分类映射的 key
    dir_name: String,
    description: String,
    path: String,
    /// "personal" | "plugin"
    source: String,
    plugin: Option<String>,
}

#[derive(Serialize)]
struct TreeNode {
    name: String,
    path: String,
    is_dir: bool,
    children: Vec<TreeNode>,
}

fn home() -> PathBuf {
    PathBuf::from(std::env::var("HOME").expect("HOME not set"))
}

/// 只允许读写 skill 相关目录，防路径穿越
fn ensure_allowed(path: &Path) -> Result<PathBuf, String> {
    let canonical = path.canonicalize().map_err(|e| e.to_string())?;
    for base in [".claude", ".agents/skills", ".codex/skills"] {
        if let Ok(b) = home().join(base).canonicalize() {
            if canonical.starts_with(&b) {
                return Ok(canonical);
            }
        }
    }
    Err(format!("path not allowed: {}", canonical.display()))
}

/// 极简 frontmatter 解析：取 --- 块里的 name / description，支持 >|- 折叠块
fn parse_frontmatter(content: &str) -> (Option<String>, Option<String>) {
    let mut lines = content.lines();
    if lines.next().map(|l| l.trim()) != Some("---") {
        return (None, None);
    }
    let mut name = None;
    let mut description = None;
    let mut block_key: Option<&str> = None;
    let mut block_val = String::new();
    for line in lines {
        if line.trim() == "---" {
            break;
        }
        let indented = line.starts_with(' ') || line.starts_with('\t');
        if let Some(key) = block_key {
            if indented || line.trim().is_empty() {
                if !block_val.is_empty() {
                    block_val.push(' ');
                }
                block_val.push_str(line.trim());
                continue;
            }
            let val = std::mem::take(&mut block_val);
            match key {
                "name" => name = Some(val),
                _ => description = Some(val),
            }
            block_key = None;
        }
        if indented {
            continue; // 嵌套字段（如 metadata），跳过
        }
        if let Some((key, val)) = line.split_once(':') {
            let key = key.trim();
            if key != "name" && key != "description" {
                continue;
            }
            let val = val.trim();
            if val.is_empty() || val == ">" || val == "|" || val == ">-" || val == "|-" {
                block_key = Some(if key == "name" { "name" } else { "description" });
            } else {
                let val = val.trim_matches('"').trim_matches('\'').to_string();
                match key {
                    "name" => name = Some(val),
                    _ => description = Some(val),
                }
            }
        }
    }
    if let Some(key) = block_key {
        match key {
            "name" => name = Some(block_val),
            _ => description = Some(block_val),
        }
    }
    (name, description)
}

fn read_skill_md(dir: &Path, source: &str, plugin: Option<String>) -> Option<SkillMeta> {
    let md = dir.join("SKILL.md");
    let content = fs::read_to_string(&md).ok()?;
    let dir_name = dir.file_name()?.to_string_lossy().to_string();
    let (name, description) = parse_frontmatter(&content);
    Some(SkillMeta {
        name: name.unwrap_or_else(|| dir_name.clone()),
        dir_name,
        description: description.unwrap_or_default(),
        path: dir.to_string_lossy().to_string(),
        source: source.to_string(),
        plugin,
    })
}

/// 在 plugins/cache 下递归找 skills/<skill>/SKILL.md；插件名取 cache 与 skills 之间
/// 去掉版本号后的最后一段（如 claude-plugins-official/superpowers/6.1.0 → superpowers）
fn scan_plugin_skills(cache: &Path, out: &mut Vec<SkillMeta>) {
    fn walk(dir: &Path, cache: &Path, depth: u32, out: &mut Vec<SkillMeta>) {
        if depth > 6 {
            return;
        }
        let Ok(entries) = fs::read_dir(dir) else { return };
        for entry in entries.flatten() {
            let path = entry.path();
            if !path.is_dir() {
                continue;
            }
            if path.file_name().map(|n| n == "skills").unwrap_or(false) {
                let plugin = plugin_name(dir, cache);
                if let Ok(skills) = fs::read_dir(&path) {
                    for skill in skills.flatten() {
                        let sp = skill.path();
                        if sp.is_dir() {
                            if let Some(meta) = read_skill_md(&sp, "plugin", Some(plugin.clone())) {
                                out.push(meta);
                            }
                        }
                    }
                }
            } else if path.file_name().map(|n| n == "node_modules").unwrap_or(false) {
                continue;
            } else {
                walk(&path, cache, depth + 1, out);
            }
        }
    }
    fn plugin_name(plugin_root: &Path, cache: &Path) -> String {
        let comps: Vec<String> = plugin_root
            .strip_prefix(cache)
            .map(|r| r.components().map(|c| c.as_os_str().to_string_lossy().to_string()).collect())
            .unwrap_or_default();
        let is_version = |s: &str| s.chars().next().map(|c| c.is_ascii_digit()).unwrap_or(false);
        comps
            .iter()
            .rev()
            .find(|c| !is_version(c))
            .cloned()
            .unwrap_or_else(|| "unknown".into())
    }
    walk(cache, cache, 0, out);
}

#[tauri::command]
fn scan_skills() -> Result<Vec<SkillMeta>, String> {
    let mut out = Vec::new();
    // 平铺目录：个人 + 跨平台 Agent Skills 中央库 + Codex
    let flat_roots = [
        (".claude/skills", "personal"),
        (".agents/skills", "agents"),
        (".codex/skills", "codex"),
    ];
    for (root, source) in flat_roots {
        let Ok(entries) = fs::read_dir(home().join(root)) else { continue };
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Some(meta) = read_skill_md(&path, source, None) {
                    out.push(meta);
                }
            }
        }
    }
    let cache = home().join(".claude/plugins/cache");
    if cache.is_dir() {
        let mut plugins = Vec::new();
        scan_plugin_skills(&cache, &mut plugins);
        // 同一插件装了多个版本时只保留一个。简化：按路径字典序取大，
        // 对 4.x/6.x 这种常见情形成立；要严格语义化版本比较再升级。
        let mut latest: std::collections::HashMap<(String, String), SkillMeta> =
            std::collections::HashMap::new();
        for meta in plugins {
            let key = (meta.plugin.clone().unwrap_or_default(), meta.dir_name.clone());
            match latest.get(&key) {
                Some(existing) if existing.path >= meta.path => {}
                _ => {
                    latest.insert(key, meta);
                }
            }
        }
        out.extend(latest.into_values());
    }
    out.sort_by(|a, b| a.dir_name.cmp(&b.dir_name));
    Ok(out)
}

#[tauri::command]
fn read_skill_tree(path: String) -> Result<TreeNode, String> {
    let root = ensure_allowed(Path::new(&path))?;
    fn build(path: &Path, depth: u32) -> TreeNode {
        let name = path.file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_default();
        let is_dir = path.is_dir();
        let mut children = Vec::new();
        if is_dir && depth < 8 {
            if let Ok(entries) = fs::read_dir(path) {
                let mut items: Vec<PathBuf> = entries.flatten().map(|e| e.path()).collect();
                items.sort_by_key(|p| (!p.is_dir(), p.file_name().map(|n| n.to_os_string())));
                for item in items {
                    children.push(build(&item, depth + 1));
                }
            }
        }
        TreeNode { name, path: path.to_string_lossy().to_string(), is_dir, children }
    }
    Ok(build(&root, 0))
}

/// 写回真实 skill 文件（仅限 ~/.claude 内、已存在的文件）
#[tauri::command]
fn write_skill_file(path: String, content: String) -> Result<(), String> {
    let file = ensure_allowed(Path::new(&path))?;
    if !file.is_file() {
        return Err("只能修改已存在的文件".into());
    }
    fs::write(&file, content).map_err(|e| e.to_string())
}

#[tauri::command]
fn read_skill_file(path: String) -> Result<String, String> {
    let file = ensure_allowed(Path::new(&path))?;
    let meta = fs::metadata(&file).map_err(|e| e.to_string())?;
    if meta.len() > 512 * 1024 {
        return Err("文件超过 512KB，不预览".into());
    }
    fs::read_to_string(&file).map_err(|_| "非文本文件，无法预览".into())
}

/// skills.sh 语义搜索（在 Rust 侧发请求，避开 webview CORS）
#[tauri::command]
fn search_similar(query: String) -> Result<String, String> {
    let resp = ureq::get("https://www.skills.sh/api/search")
        .query("q", &query)
        .timeout(std::time::Duration::from_secs(10))
        .call()
        .map_err(|e| format!("请求 skills.sh 失败：{e}"))?;
    resp.into_string().map_err(|e| e.to_string())
}

const DEFAULT_CATEGORIES: &str = include_str!("../../config/categories.json");
const DEFAULT_TEMPLATES: &str = include_str!("../../config/templates.json");
const DEFAULT_SUMMARIES: &str = include_str!("../../config/summaries.json");

fn user_config_dir() -> PathBuf {
    home().join("Library/Application Support/skill-kanban")
}

#[derive(Serialize)]
struct AppConfig {
    categories_default: String,
    categories_user: Option<String>,
    templates_default: String,
    templates_user: Option<String>,
    summaries_default: String,
    summaries_user: Option<String>,
}

/// 内置默认 + 用户配置（前端做合并，用户条目覆盖同名默认条目）
#[tauri::command]
fn load_config() -> AppConfig {
    let dir = user_config_dir();
    let user = |file: &str| fs::read_to_string(dir.join(file)).ok();
    AppConfig {
        categories_default: DEFAULT_CATEGORIES.into(),
        categories_user: user("categories.json"),
        templates_default: DEFAULT_TEMPLATES.into(),
        templates_user: user("templates.json"),
        summaries_default: DEFAULT_SUMMARIES.into(),
        summaries_user: user("summaries.json"),
    }
}

#[tauri::command]
fn save_categories(content: String) -> Result<(), String> {
    serde_json::from_str::<serde_json::Value>(&content).map_err(|e| format!("invalid json: {e}"))?;
    let dir = user_config_dir();
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    fs::write(dir.join("categories.json"), content).map_err(|e| e.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn frontmatter_single_line() {
        let (name, desc) = parse_frontmatter("---\nname: foo\ndescription: bar baz\n---\nbody");
        assert_eq!(name.as_deref(), Some("foo"));
        assert_eq!(desc.as_deref(), Some("bar baz"));
    }

    #[test]
    fn frontmatter_block_scalar() {
        let content = "---\nname: foo\ndescription: >\n  line one\n  line two\nmetadata:\n  type: user\n---\n";
        let (name, desc) = parse_frontmatter(content);
        assert_eq!(name.as_deref(), Some("foo"));
        assert_eq!(desc.as_deref(), Some("line one line two"));
    }

    #[test]
    fn frontmatter_missing() {
        assert_eq!(parse_frontmatter("no frontmatter here"), (None, None));
    }

    #[test]
    fn write_guard_and_roundtrip() {
        // 目录外拒绝
        assert!(write_skill_file("/etc/hosts".into(), "x".into()).is_err());
        // 允许目录内：建临时文件 → 写 → 读回 → 清理
        let tmp = home().join(".claude/skills/.kanban-write-test.txt");
        fs::write(&tmp, "before").unwrap();
        write_skill_file(tmp.to_string_lossy().into(), "after".into()).unwrap();
        assert_eq!(fs::read_to_string(&tmp).unwrap(), "after");
        fs::remove_file(&tmp).unwrap();
    }

    #[test]
    fn scan_real_skills() {
        let skills = scan_skills().unwrap();
        assert!(skills.len() > 60, "expected 60+ skills, got {}", skills.len());
        assert!(skills.iter().any(|s| s.source == "personal"));
        assert!(skills.iter().any(|s| s.source == "agents"), "~/.agents/skills not scanned");
        let plugin = skills.iter().find(|s| s.source == "plugin");
        assert!(plugin.is_some());
        assert!(plugin.unwrap().plugin.is_some());
        // 多版本插件去重后，同 (plugin, dir_name) 只能出现一次
        let mut seen = std::collections::HashSet::new();
        for s in skills.iter().filter(|s| s.source == "plugin") {
            assert!(
                seen.insert((s.plugin.clone(), s.dir_name.clone())),
                "duplicate plugin skill: {:?}/{}",
                s.plugin,
                s.dir_name
            );
        }
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            scan_skills,
            read_skill_tree,
            read_skill_file,
            write_skill_file,
            load_config,
            save_categories,
            search_similar
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
