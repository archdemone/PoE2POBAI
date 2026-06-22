import React from "react";
import type { BuildInfo } from "../types";

interface BuildSidebarProps {
  builds: BuildInfo[];
  activeId: string | null;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onImport: () => void;
}

export function BuildSidebar({ builds, activeId, onSelect, onDelete, onImport }: BuildSidebarProps) {
  return (
    <div className="build-sidebar">
      <div className="build-sidebar-header">
        <h3>Builds</h3>
        <button className="import-btn" onClick={onImport}>+ Import</button>
      </div>
      <div className="build-list">
        {builds.map((b) => (
          <div key={b.snapshot_id} className={`build-chip ${b.snapshot_id === activeId ? "active" : ""}`}
            onClick={() => onSelect(b.snapshot_id)}>
            <div className="build-chip-label">{b.label}</div>
            <div className="build-chip-meta">{b.character?.className} {b.character?.level}</div>
            <button className="build-chip-delete" onClick={(e) => { e.stopPropagation(); onDelete(b.snapshot_id); }}>x</button>
          </div>
        ))}
        {builds.length === 0 && <div className="build-empty">No builds yet. Import one!</div>}
      </div>
    </div>
  );
}
