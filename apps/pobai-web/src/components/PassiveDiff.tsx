import React from "react";

interface TreeNode {
  id: string;
  name: string;
  type: "keystone" | "notable" | "mastery" | "ascendancy" | "jewel" | "small" | "unknown";
  stats?: string[];
  ascendancy?: string;
}

interface NodeDescription {
  groups?: Partial<Record<TreeNode["type"], TreeNode[]>>;
  named?: number;
  total?: number;
}

const NODE_TYPE_LABELS: Record<TreeNode["type"], string> = {
  keystone: "Keystones",
  notable: "Notables",
  mastery: "Masteries",
  ascendancy: "Ascendancy",
  jewel: "Jewel sockets",
  small: "Small passives",
  unknown: "Other nodes",
};

const NODE_TYPE_ORDER: TreeNode["type"][] = ["keystone", "notable", "mastery", "ascendancy", "jewel", "small", "unknown"];

export function NodeGroups({ title, tone, desc }: { title: string; tone: "added" | "removed"; desc?: NodeDescription }) {
  const groups = desc?.groups;
  if (!groups || Object.keys(groups).length === 0) return null;
  const sign = tone === "added" ? "+" : "−";
  return (
    <div className="node-groups">
      <h5 className={`node-groups-title gem-${tone}`}>{title}</h5>
      {NODE_TYPE_ORDER.filter((type) => groups[type]?.length).map((type) => (
        <div key={type} className="node-group">
          <span className="node-group-label">{NODE_TYPE_LABELS[type]} ({groups[type]!.length})</span>
          <ul className="node-list">
            {groups[type]!.map((node) => (
              <li key={node.id} className={`node-row node-${type}`}>
                <span className={`node-name gem-${tone}`}>{sign} {node.name}</span>
                {node.stats && node.stats.length > 0 && (
                  <span className="node-stats">{node.stats.join(" · ")}</span>
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  );
}
