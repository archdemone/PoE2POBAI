import React from "react";

interface SkillChange {
  label: string;
  gems: string[];
}

interface ItemChange {
  slot?: string;
  name?: string;
}

interface DefenseChange {
  from?: string;
  to?: string;
}

interface PassivesChange {
  nodesAdded: number;
  nodesRemoved: number;
}

interface SnapshotDiff {
  baseId: string;
  targetId: string;
  skillsAdded: SkillChange[];
  skillsRemoved: SkillChange[];
  itemsAdded: ItemChange[];
  itemsRemoved: ItemChange[];
  defensesChanged: Record<string, DefenseChange>;
  passivesChanged: PassivesChange;
  textPatch?: string;
}

export function DiffView({ diff }: { diff: SnapshotDiff }) {
  const hasChanges =
    diff.skillsAdded.length > 0 ||
    diff.skillsRemoved.length > 0 ||
    diff.itemsAdded.length > 0 ||
    diff.itemsRemoved.length > 0 ||
    Object.keys(diff.defensesChanged).length > 0 ||
    diff.passivesChanged.nodesAdded > 0 ||
    diff.passivesChanged.nodesRemoved > 0;

  if (!hasChanges) {
    return <div className="diff-view diff-empty">No differences between these builds.</div>;
  }

  return (
    <div className="diff-view">
      {diff.skillsRemoved.length > 0 && (
        <div className="diff-section">
          <h4 className="diff-heading diff-heading-removed">Skills Removed ({diff.skillsRemoved.length})</h4>
          {diff.skillsRemoved.map((s, i) => (
            <div key={i} className="diff-item diff-item-removed">
              <span className="diff-item-label">{s.label}</span>
              {s.gems.length > 0 && <span className="diff-item-detail">{s.gems.join(", ")}</span>}
            </div>
          ))}
        </div>
      )}
      {diff.skillsAdded.length > 0 && (
        <div className="diff-section">
          <h4 className="diff-heading diff-heading-added">Skills Added ({diff.skillsAdded.length})</h4>
          {diff.skillsAdded.map((s, i) => (
            <div key={i} className="diff-item diff-item-added">
              <span className="diff-item-label">{s.label}</span>
              {s.gems.length > 0 && <span className="diff-item-detail">{s.gems.join(", ")}</span>}
            </div>
          ))}
        </div>
      )}
      {diff.itemsRemoved.length > 0 && (
        <div className="diff-section">
          <h4 className="diff-heading diff-heading-removed">Items Removed ({diff.itemsRemoved.length})</h4>
          {diff.itemsRemoved.map((item, i) => (
            <div key={i} className="diff-item diff-item-removed">
              <span className="diff-item-label">{item.slot || "unknown"}</span>
              {item.name && <span className="diff-item-detail">{item.name}</span>}
            </div>
          ))}
        </div>
      )}
      {diff.itemsAdded.length > 0 && (
        <div className="diff-section">
          <h4 className="diff-heading diff-heading-added">Items Added ({diff.itemsAdded.length})</h4>
          {diff.itemsAdded.map((item, i) => (
            <div key={i} className="diff-item diff-item-added">
              <span className="diff-item-label">{item.slot || "unknown"}</span>
              {item.name && <span className="diff-item-detail">{item.name}</span>}
            </div>
          ))}
        </div>
      )}
      {Object.keys(diff.defensesChanged).length > 0 && (
        <div className="diff-section">
          <h4 className="diff-heading">Defenses Changed</h4>
          {Object.entries(diff.defensesChanged).map(([key, change], i) => (
            <div key={i} className="diff-item">
              <span className="diff-item-label">{key}</span>
              <span className="diff-item-detail">
                {change.from ?? "(none)"} → {change.to ?? "(none)"}
              </span>
            </div>
          ))}
        </div>
      )}
      {(diff.passivesChanged.nodesAdded > 0 || diff.passivesChanged.nodesRemoved > 0) && (
        <div className="diff-section">
          <h4 className="diff-heading">Passive Tree Changed</h4>
          <div className="diff-item">
            {diff.passivesChanged.nodesAdded > 0 && (
              <span className="diff-item-added">+{diff.passivesChanged.nodesAdded} nodes</span>
            )}
            {diff.passivesChanged.nodesRemoved > 0 && (
              <span className="diff-item-removed">-{diff.passivesChanged.nodesRemoved} nodes</span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
