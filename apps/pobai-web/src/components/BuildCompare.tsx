import React, { useEffect, useMemo, useRef, useState } from "react";
import { DiffView, type BuildCompareResult } from "./DiffView";
import { StatSheet } from "./StatSheet";
import { EquipmentTab } from "./EquipmentTab";
import { SkillsTab } from "./SkillsTab";
import type { BuildInfo } from "../types";
import { readErrorMessage } from "../http";

type Tab = "stats" | "equipment" | "skills";

interface BuildCompareProps {
  builds: BuildInfo[];
  activeBuildId: string | null;
  apiBaseUrl: string;
  pob2Connected?: boolean;
  bridgeUrl?: string;
  importingCurrent?: boolean;
  onImportCurrent?: () => Promise<void>;
  onOpenImport?: () => void;
  chatNode?: React.ReactNode;
}

function buildLabel(build: BuildInfo | undefined): string {
  if (!build) return "Unknown build";
  const bits = [
    build.label,
    build.character?.className,
    build.character?.ascendancy,
    build.character?.level ? `level ${build.character.level}` : "",
  ].filter(Boolean);
  return bits.join(" - ");
}

export function BuildCompare({
  builds,
  activeBuildId,
  apiBaseUrl,
  pob2Connected = false,
  bridgeUrl,
  importingCurrent = false,
  onImportCurrent,
  onOpenImport,
  chatNode,
}: BuildCompareProps) {
  const buildIds = useMemo(() => builds.map((b) => b.snapshot_id), [builds]);
  const autoCompareKey = useRef("");
  const seenBuildIds = useRef<Set<string>>(new Set());
  const [baseId, setBaseId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [comparison, setComparison] = useState<BuildCompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<Tab>("stats");

  useEffect(() => {
    setBaseId((current) => {
      if (current && buildIds.includes(current)) return current;
      if (activeBuildId && buildIds.includes(activeBuildId)) return activeBuildId;
      return buildIds[0] ?? "";
    });
  }, [activeBuildId, buildIds]);

  useEffect(() => {
    const added = buildIds.filter((id) => !seenBuildIds.current.has(id));
    seenBuildIds.current = new Set(buildIds);
    setTargetId((current) => {
      const freshlyImported = added.find((id) => id === activeBuildId && id !== baseId);
      if (freshlyImported) return freshlyImported;
      if (current && buildIds.includes(current) && current !== baseId) return current;
      return buildIds.find((id) => id !== baseId) ?? "";
    });
  }, [activeBuildId, baseId, buildIds]);

  const baseBuild = builds.find((b) => b.snapshot_id === baseId);
  const targetBuild = builds.find((b) => b.snapshot_id === targetId);
  const bothLoaded = Boolean(baseId) && Boolean(targetId) && baseId !== targetId;
  const canCompare = bothLoaded && !loading;

  useEffect(() => {
    const key = `${baseId}:${targetId}:${buildIds.join(",")}`;
    if (!baseId || !targetId || baseId === targetId || autoCompareKey.current === key) return;
    autoCompareKey.current = key;
    void runCompare();
  }, [baseId, targetId, buildIds]);

  async function runCompare() {
    if (!baseId || !targetId || baseId === targetId || loading) return;
    setLoading(true);
    setError(null);
    setComparison(null);
    try {
      const res = await fetch(`${apiBaseUrl}/api/build/compare`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseId, targetId }),
      });
      if (!res.ok) throw new Error(await readErrorMessage(res));
      setComparison((await res.json()) as BuildCompareResult);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Compare failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <section className="compare-panel" aria-label="Build comparison">
      {/* Compare strip */}
      <div className="compare-strip">
        <BuildSlotMini
          label="My build"
          value={baseId}
          options={builds}
          disabledOption={targetId}
          onChange={setBaseId}
          actions={
            <>
              {onImportCurrent && (
                <button className="btn-xs" onClick={onImportCurrent} disabled={!pob2Connected || importingCurrent} title={pob2Connected ? "Import active PoB build" : "PoB bridge offline"}>
                  {importingCurrent ? "…" : "↑ PoB"}
                </button>
              )}
              {onOpenImport && <button className="btn-xs" onClick={onOpenImport}>+ Import</button>}
            </>
          }
        />

        <div className="compare-vs-block">
          <span className="compare-vs">VS</span>
          <button className="btn-primary compare-btn" onClick={runCompare} disabled={!canCompare}>
            {loading ? "Comparing…" : "Compare"}
          </button>
        </div>

        <BuildSlotMini
          label="Target build"
          value={targetId}
          options={builds}
          disabledOption={baseId}
          onChange={setTargetId}
          actions={onOpenImport && <button className="btn-xs" onClick={onOpenImport}>+ Import</button>}
        />
      </div>

      {!pob2Connected && (
        <div className="bridge-banner">
          PoB bridge offline — paste a PoB code or poe.ninja link to import builds.
        </div>
      )}

      {error && <div className="compare-error">{error}</div>}

      {/* Content area: tabs + chat side by side */}
      <div className="compare-body">
        <div className="compare-main">
          {builds.length < 2 && (
            <div className="compare-empty">
              Load at least two builds to compare. Use the Import buttons above.
            </div>
          )}

          {(builds.length >= 2 || comparison) && (
            <>
              <div className="content-tabs" role="tablist">
                {(["stats", "equipment", "skills"] as Tab[]).map((tab) => (
                  <button
                    key={tab}
                    role="tab"
                    aria-selected={activeTab === tab}
                    className={`content-tab${activeTab === tab ? " content-tab-active" : ""}`}
                    onClick={() => setActiveTab(tab)}
                  >
                    {tab.charAt(0).toUpperCase() + tab.slice(1)}
                  </button>
                ))}
              </div>

              <div className="tab-body">
                {loading && <div className="compare-hint">Comparing builds…</div>}

                {!loading && activeTab === "stats" && (
                  <>
                    {comparison && <StatSheet diff={comparison} />}
                    {comparison && <DiffView diff={comparison} showStats={false} />}
                    {!comparison && bothLoaded && <div className="compare-hint">Click Compare to see differences.</div>}
                  </>
                )}

                {!loading && activeTab === "equipment" && (
                  <EquipmentTab diff={comparison} />
                )}

                {!loading && activeTab === "skills" && (
                  <SkillsTab diff={comparison} />
                )}
              </div>
            </>
          )}
        </div>

        {chatNode && <div className="compare-chat">{chatNode}</div>}
      </div>
    </section>
  );
}

function BuildSlotMini({
  label,
  value,
  options,
  disabledOption,
  onChange,
  actions,
}: {
  label: string;
  value: string;
  options: BuildInfo[];
  disabledOption: string;
  onChange: (id: string) => void;
  actions?: React.ReactNode;
}) {
  return (
    <div className="build-slot-mini">
      <span className="build-slot-mini-label">{label}</span>
      <select aria-label={label} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— select —</option>
        {options.map((b) => (
          <option key={b.snapshot_id} value={b.snapshot_id} disabled={b.snapshot_id === disabledOption}>
            {buildLabel(b)}
          </option>
        ))}
      </select>
      {actions && <div className="build-slot-mini-actions">{actions}</div>}
    </div>
  );
}
