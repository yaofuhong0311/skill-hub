import { useState } from "react";
import { TreeNode } from "../types";

interface Props {
  node: TreeNode;
  onSelectFile: (path: string) => void;
  selectedPath: string | null;
  depth?: number;
}

export function FileTree({ node, onSelectFile, selectedPath, depth = 0 }: Props) {
  const [open, setOpen] = useState(depth === 0);

  if (node.is_dir) {
    return (
      <div className="tree-node">
        <div
          className="tree-row tree-dir"
          style={{ paddingLeft: depth * 14 }}
          onClick={() => setOpen(!open)}
        >
          <span className="tree-arrow">{open ? "▾" : "▸"}</span> 📁 {node.name}
        </div>
        {open &&
          node.children.map((child) => (
            <FileTree
              key={child.path}
              node={child}
              onSelectFile={onSelectFile}
              selectedPath={selectedPath}
              depth={depth + 1}
            />
          ))}
      </div>
    );
  }

  return (
    <div
      className={`tree-row tree-file ${selectedPath === node.path ? "selected" : ""}`}
      style={{ paddingLeft: depth * 14 + 16 }}
      onClick={() => onSelectFile(node.path)}
    >
      📄 {node.name}
    </div>
  );
}
