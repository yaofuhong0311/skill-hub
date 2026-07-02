import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { openUrl } from "@tauri-apps/plugin-opener";
import ReactMarkdown from "react-markdown";
import { SkillMeta, TreeNode, Category } from "../types";
import { FileTree } from "./FileTree";
import { fallbackTemplate } from "../classify";
import { sourceLabel } from "../App";

interface SimilarSkill {
  id: string;
  skillId: string;
  name: string;
  installs: number;
  source: string;
}

interface Props {
  skill: SkillMeta;
  summary: string;
  template: string | undefined;
  categories: Category[];
  currentCategory: string;
  onBack: () => void;
  onChangeCategory: (catId: string) => void;
}

export function SkillDetail({
  skill,
  summary,
  template,
  categories,
  currentCategory,
  onBack,
  onChangeCategory,
}: Props) {
  const [tree, setTree] = useState<TreeNode | null>(null);
  const [filePath, setFilePath] = useState<string | null>(null);
  const [fileContent, setFileContent] = useState<string>("");
  const [copied, setCopied] = useState(false);
  const [values, setValues] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [saveMsg, setSaveMsg] = useState("");
  const [similar, setSimilar] = useState<SimilarSkill[] | null>(null);
  const [similarOpen, setSimilarOpen] = useState(false);
  const [similarErr, setSimilarErr] = useState("");

  const prompt = template ?? fallbackTemplate(skill);
  const placeholders = [...new Set([...prompt.matchAll(/\{([^{}]+)\}/g)].map((m) => m[1]))];
  const filled = (name: string) => (values[name] ?? "").trim();
  const finalPrompt = prompt.replace(/\{([^{}]+)\}/g, (raw, name) => filled(name) || raw);

  useEffect(() => {
    setValues({});
    invoke<TreeNode>("read_skill_tree", { path: skill.path }).then(setTree).catch(console.error);
    const md = `${skill.path}/SKILL.md`;
    setFilePath(md);
    invoke<string>("read_skill_file", { path: md })
      .then(setFileContent)
      .catch((e) => setFileContent(String(e)));
  }, [skill.path]);

  const selectFile = (path: string) => {
    setFilePath(path);
    setEditing(false);
    setSaveMsg("");
    invoke<string>("read_skill_file", { path })
      .then(setFileContent)
      .catch((e) => setFileContent(String(e)));
  };

  const saveFile = async () => {
    if (!filePath) return;
    try {
      await invoke("write_skill_file", { path: filePath, content: draft });
      setFileContent(draft);
      setEditing(false);
      setSaveMsg("✓ 已保存到源文件");
      setTimeout(() => setSaveMsg(""), 2500);
    } catch (e) {
      setSaveMsg(`保存失败：${e}`);
    }
  };

  // 语义找类似：用 description（面向能力的长文本）当查询，比名字准
  const findSimilar = async () => {
    setSimilarOpen(true);
    setSimilar(null);
    setSimilarErr("");
    const query = `${skill.name} ${skill.description}`.slice(0, 300);
    try {
      const raw = await invoke<string>("search_similar", { query });
      const data = JSON.parse(raw);
      setSimilar((data.skills ?? []).slice(0, 8));
    } catch (e) {
      setSimilarErr(String(e));
    }
  };

  const copyPrompt = async () => {
    await navigator.clipboard.writeText(finalPrompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  // 按占位符切开模板，占位符渲染成高亮片段（已填=实际值，未填=占位提示）
  const promptParts = prompt.split(/(\{[^{}]+\})/g).map((part, i) => {
    const m = part.match(/^\{([^{}]+)\}$/);
    if (!m) return <span key={i}>{part}</span>;
    const v = filled(m[1]);
    return (
      <span key={i} className={`ph ${v ? "ph-filled" : ""}`}>
        {v || part}
      </span>
    );
  });

  const isMarkdown = filePath?.endsWith(".md") ?? false;
  // frontmatter 不是 markdown，直接渲染会被当成 setext 标题；剥掉（name/description 已在页头展示）
  const mdContent = fileContent.startsWith("---\n")
    ? fileContent.replace(/^---\n[\s\S]*?\n---\n?/, "")
    : fileContent;

  return (
    <div className="detail">
      <div className="detail-header">
        <button className="back-btn" onClick={onBack}>← 返回</button>
        <div className="detail-title">
          <h2>{skill.name}</h2>
          <div className="detail-summary">{summary}</div>
        </div>
        <span className={`badge ${skill.source}`}>{sourceLabel(skill)}</span>
        <button className="back-btn" title="用 skills.sh 语义搜索找功能类似的 skill" onClick={findSimilar}>
          skills.sh 找类似
        </button>
        <select
          className="cat-select"
          value={currentCategory}
          onChange={(e) => onChangeCategory(e.target.value)}
          title="调整分类"
        >
          {categories.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      </div>

      {placeholders.length > 0 && (
        <div className="ph-inputs">
          {placeholders.map((name) => (
            <label key={name} className="ph-input">
              <span className="ph-label">{name}</span>
              <input
                value={values[name] ?? ""}
                placeholder={`填写${name}…`}
                onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))}
              />
            </label>
          ))}
        </div>
      )}

      <div className="prompt-box">
        <div className="prompt-text">{promptParts}</div>
        <button className="copy-btn" onClick={copyPrompt}>
          {copied ? "✓ 已复制" : "复制 Prompt"}
        </button>
      </div>

      {similarOpen && (
        <div className="modal-mask" onClick={() => setSimilarOpen(false)}>
          <div className="modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-head">
              <span>与「{skill.name}」功能类似的 skill</span>
              <button className="cancel-btn" onClick={() => setSimilarOpen(false)}>关闭</button>
            </div>
            {similarErr && <div className="modal-hint">{similarErr}</div>}
            {!similar && !similarErr && <div className="modal-hint">语义搜索中…</div>}
            {similar && similar.length === 0 && (
              <div className="modal-hint">skills.sh 上没找到类似的（内部/私有 skill 属正常）</div>
            )}
            {similar?.map((s) => (
              <div
                key={s.id}
                className="similar-row"
                title="在浏览器查看该 skill"
                onClick={() => openUrl(`https://www.skills.sh/${s.id}`)}
              >
                <span className="similar-name">{s.name}</span>
                <span className="similar-src">{s.source}</span>
                <span className="similar-installs">⤓ {s.installs.toLocaleString()}</span>
              </div>
            ))}
            <div className="modal-foot">
              <button
                className="edit-btn"
                onClick={() => openUrl(`https://www.skills.sh/search?q=${encodeURIComponent(skill.name)}`)}
              >
                在浏览器打开搜索页 ↗
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="detail-body">
        <div className="tree-panel">
          {tree ? (
            <FileTree node={tree} onSelectFile={selectFile} selectedPath={filePath} />
          ) : (
            <div className="loading">加载目录…</div>
          )}
        </div>
        <div className="file-panel">
          <div className="file-toolbar">
            <span className="file-name">{filePath?.split("/").pop()}</span>
            {editing ? (
              <span className="file-actions">
                <button className="save-btn" onClick={saveFile}>保存</button>
                <button className="cancel-btn" onClick={() => setEditing(false)}>取消</button>
              </span>
            ) : (
              <span className="file-actions">
                {saveMsg && <span className="save-msg">{saveMsg}</span>}
                <button
                  className="edit-btn"
                  onClick={() => {
                    setDraft(fileContent);
                    setEditing(true);
                  }}
                >
                  ✎ 编辑
                </button>
              </span>
            )}
          </div>
          {editing ? (
            <textarea
              className="editor"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              spellCheck={false}
            />
          ) : isMarkdown ? (
            <div className="markdown-body">
              <ReactMarkdown>{mdContent}</ReactMarkdown>
            </div>
          ) : (
            <pre className="code-body">{fileContent}</pre>
          )}
        </div>
      </div>
    </div>
  );
}
