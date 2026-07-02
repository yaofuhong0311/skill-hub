export interface SkillMeta {
  name: string;
  dir_name: string;
  description: string;
  path: string;
  source: "personal" | "plugin" | "agents" | "codex";
  plugin: string | null;
}

export interface Category {
  id: string;
  name: string;
  order: number;
}

export interface CategoriesConfig {
  categories: Category[];
  mapping: Record<string, string>;
}

export type TemplatesConfig = Record<string, string>;
export type SummariesConfig = Record<string, string>;

export interface TreeNode {
  name: string;
  path: string;
  is_dir: boolean;
  children: TreeNode[];
}

export const UNCATEGORIZED = "uncategorized";
