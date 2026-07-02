import { CategoriesConfig, SkillMeta, UNCATEGORIZED } from "./types";

/** 规则兜底：mapping 里没有的新 skill 按前缀/关键词归类。
 *  规则里的分类 id 必须存在于 categories.json，否则落到未分类。 */
const PREFIX_RULES: Array<[RegExp, string]> = [
  [/^golang-/, "go-dev"],
  [/^lark-/, "office-collab"],
  [/^python-/, "general-dev"],
];

const KEYWORD_RULES: Array<[RegExp, string]> = [
  [/测试|验证|verify|review|审查|debug/i, "testing-verify"],
  [/规范|standard|lint|cicd|ci\/cd/i, "standards-review"],
  [/飞书|lark|文档协作/i, "office-collab"],
  [/画图|绘图|图片|infographic|视觉|海报/i, "ai-drawing"],
  [/plan|brainstorm|流程|计划|skill/i, "workflow"],
  [/api|后端|数据库|frontend|前端|架构/i, "general-dev"],
];

export function classify(skill: SkillMeta, config: CategoriesConfig): string {
  const mapped = config.mapping[skill.dir_name];
  const valid = (id: string) => config.categories.some((c) => c.id === id);
  if (mapped && valid(mapped)) return mapped;
  for (const [re, cat] of PREFIX_RULES) {
    if (re.test(skill.dir_name) && valid(cat)) return cat;
  }
  const text = `${skill.dir_name} ${skill.description}`;
  for (const [re, cat] of KEYWORD_RULES) {
    if (re.test(text) && valid(cat)) return cat;
  }
  return UNCATEGORIZED;
}

/** 通用模板兜底 */
export function fallbackTemplate(skill: SkillMeta): string {
  const brief = skill.description.slice(0, 60);
  return `请使用 ${skill.dir_name} skill（${brief}…）。我的任务：{具体任务}`;
}

/** 简介兜底：summaries 没有时，取 description 里【标签】后到 ｜ 前的中文短句，再兜底截断 */
export function fallbackSummary(skill: SkillMeta): string {
  const desc = skill.description;
  const zh = desc.match(/^【[^】]+】([^｜|]+)/);
  if (zh) return zh[1].trim();
  return desc.length > 50 ? desc.slice(0, 50) + "…" : desc || "（无描述）";
}
