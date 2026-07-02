import { useEffect, useMemo, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  SkillMeta,
  CategoriesConfig,
  TemplatesConfig,
  SummariesConfig,
  Category,
  UNCATEGORIZED,
} from "./types";
import { classify, fallbackSummary } from "./classify";
import { SkillDetail } from "./components/SkillDetail";
import "./App.css";

interface RawConfig {
  categories_default: string;
  categories_user: string | null;
  templates_default: string;
  templates_user: string | null;
  summaries_default: string;
  summaries_user: string | null;
}

/** 用户配置按条目合并覆盖内置默认（分类按 id 去重，用户优先） */
function mergeCategories(def: CategoriesConfig, user: CategoriesConfig | null): CategoriesConfig {
  if (!user) return def;
  const byId = new Map(def.categories.map((c) => [c.id, c]));
  for (const c of user.categories ?? []) byId.set(c.id, c);
  return {
    categories: [...byId.values()],
    mapping: { ...def.mapping, ...(user.mapping ?? {}) },
  };
}

function mergeRecord(defJson: string, userJson: string | null): Record<string, string> {
  return { ...JSON.parse(defJson), ...(userJson ? JSON.parse(userJson) : {}) };
}

export function sourceLabel(s: SkillMeta): string {
  if (s.source === "personal") return "个人";
  if (s.source === "agents") return "Agents 库";
  if (s.source === "codex") return "Codex";
  return s.plugin ?? "插件";
}

function App() {
  const [skills, setSkills] = useState<SkillMeta[]>([]);
  const [config, setConfig] = useState<CategoriesConfig | null>(null);
  const [templates, setTemplates] = useState<TemplatesConfig>({});
  const [summaries, setSummaries] = useState<SummariesConfig>({});
  const [activeCat, setActiveCat] = useState<string>("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<SkillMeta | null>(null);

  const load = async () => {
    const raw = await invoke<RawConfig>("load_config");
    const cfg = mergeCategories(
      JSON.parse(raw.categories_default),
      raw.categories_user ? JSON.parse(raw.categories_user) : null
    );
    setTemplates(mergeRecord(raw.templates_default, raw.templates_user));
    setSummaries(mergeRecord(raw.summaries_default, raw.summaries_user));
    setConfig(cfg);
    const list = await invoke<SkillMeta[]>("scan_skills");
    setSkills(list);
    setActiveCat((cur) => cur || (cfg.categories.length ? cfg.categories[0].id : ""));
  };

  useEffect(() => {
    load().catch(console.error);
  }, []);

  const allCategories: Category[] = useMemo(() => {
    if (!config) return [];
    const sorted = [...config.categories].sort((a, b) => a.order - b.order);
    return [...sorted, { id: UNCATEGORIZED, name: "未分类", order: 999 }];
  }, [config]);

  const catOf = useMemo(() => {
    const m = new Map<string, string>();
    if (config) for (const s of skills) m.set(s.path, classify(s, config));
    return m;
  }, [skills, config]);

  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const id of catOf.values()) c.set(id, (c.get(id) ?? 0) + 1);
    return c;
  }, [catOf]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return skills.filter((s) => {
      if (q) {
        return (
          s.dir_name.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q) ||
          s.description.toLowerCase().includes(q) ||
          (summaries[s.dir_name] ?? "").toLowerCase().includes(q)
        );
      }
      return catOf.get(s.path) === activeCat;
    });
  }, [skills, search, activeCat, catOf, summaries]);

  const summaryOf = (s: SkillMeta) => summaries[s.dir_name] ?? fallbackSummary(s);

  // 缺配置的 skill（发给别人 / 新装 skill 时用）：生成一段 prompt 让任意 AI 编程助手就地补全
  const missing = useMemo(
    () =>
      skills.filter(
        (s) => !config?.mapping[s.dir_name] || !summaries[s.dir_name] || !templates[s.dir_name]
      ),
    [skills, config, summaries, templates]
  );
  const [promptCopied, setPromptCopied] = useState(false);

  const copyFillPrompt = async () => {
    if (!config) return;
    const cats = allCategories
      .filter((c) => c.id !== UNCATEGORIZED)
      .map((c) => `${c.id}（${c.name}）`)
      .join("、");
    const list = missing.map((s) => `- ${s.path}/SKILL.md`).join("\n");
    const text = `请为我的 Skill Hub 应用补全 ${missing.length} 个 skill 的配置。

第一步：逐个读取以下 SKILL.md 的 frontmatter（name、description）：
${list}

第二步：在 ~/Library/Application Support/skill-hub/ 目录下创建或更新三个 JSON 文件（如已存在则合并，保留已有条目，只新增/覆盖这批 skill 的条目；key 一律用 skill 的目录名）：
1. categories.json：格式 {"categories":[{"id","name","order"}...],"mapping":{"skill目录名":"分类id"}}。可用分类：${cats}；确实放不进的可新增分类。
2. summaries.json：{"skill目录名":"中文一句话简介（≤35字，讲清能帮我干什么）"}
3. templates.json：{"skill目录名":"中文 prompt 模板，变量用{中文占位符}，明确写「请使用 xxx skill」"}

第三步：用 python3 -m json.tool 校验三个文件合法，并确认三个文件都覆盖了这 ${missing.length} 个 skill。

完成后告诉我，我会在看板里点「重新扫描」加载。`;
    await navigator.clipboard.writeText(text);
    setPromptCopied(true);
    setTimeout(() => setPromptCopied(false), 2000);
  };

  const changeCategory = async (skill: SkillMeta, catId: string) => {
    if (!config) return;
    const next: CategoriesConfig = {
      ...config,
      mapping: { ...config.mapping, [skill.dir_name]: catId },
    };
    setConfig(next);
    await invoke("save_categories", { content: JSON.stringify(next, null, 2) });
  };

  if (!config) return <div className="loading app-loading">加载中…</div>;

  if (selected) {
    return (
      <SkillDetail
        skill={selected}
        summary={summaryOf(selected)}
        template={templates[selected.dir_name]}
        categories={allCategories}
        currentCategory={catOf.get(selected.path) ?? UNCATEGORIZED}
        onBack={() => setSelected(null)}
        onChangeCategory={(catId) => changeCategory(selected, catId)}
      />
    );
  }

  const activeName = search
    ? `搜索「${search}」`
    : allCategories.find((c) => c.id === activeCat)?.name ?? "";

  return (
    <div className="layout">
      <aside className="sidebar">
        <div className="sidebar-title">
          <span className="sidebar-logo">▦</span> Skill Hub
        </div>
        <input
          className="search"
          placeholder="搜索 skill…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <div className="cat-section-label">分类</div>
        <div className="cat-list">
          {allCategories.map((c) => (
            <div
              key={c.id}
              className={`cat-item ${!search && activeCat === c.id ? "active" : ""}`}
              onClick={() => {
                setSearch("");
                setActiveCat(c.id);
              }}
            >
              <span>{c.name}</span>
              <span className="cat-count">{counts.get(c.id) ?? 0}</span>
            </div>
          ))}
        </div>
        <div className="sidebar-foot">
          <span>共 {skills.length} 个 skill</span>
          {missing.length > 0 ? (
            <button className="fill-btn" onClick={copyFillPrompt} title="复制一段 prompt，粘到 Claude Code / Codex 等任意 AI 编程助手里，为缺配置的 skill 生成分类/简介/模板">
              {promptCopied ? "✓ 已复制，去粘给你的 AI 编程助手" : `⚙ 补全配置 Prompt（${missing.length}）`}
            </button>
          ) : (
            <span className="fill-ok" title="装了新 skill 或把应用发给别人时，这里会出现「补全配置 Prompt」按钮">
              ✓ 分类/简介/模板已齐全
            </span>
          )}
        </div>
      </aside>

      <main className="grid-area">
        <div className="page-header">
          <div>
            <h1>{activeName}</h1>
            <div className="page-sub">{visible.length} 个 skill</div>
          </div>
          <button className="refresh-btn" onClick={() => load()}>⟳ 重新扫描</button>
        </div>
        <div className="grid">
          {visible.map((s) => (
            <div key={s.path} className="card" onClick={() => setSelected(s)}>
              <div className="card-head">
                <span className="card-name">{s.name}</span>
                <span className={`badge ${s.source}`}>{sourceLabel(s)}</span>
              </div>
              <div className="card-summary">{summaryOf(s)}</div>
            </div>
          ))}
          {visible.length === 0 && <div className="empty">这个分类下没有 skill</div>}
        </div>
      </main>
    </div>
  );
}

export default App;
