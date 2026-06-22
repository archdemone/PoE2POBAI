import React, { useEffect, useMemo, useRef, useState } from "react";
import { DiffView, type BuildCompareResult } from "./DiffView";
import type { BuildInfo } from "../types";

interface BuildCompareProps {
  builds: BuildInfo[];
  activeBuildId: string | null;
  apiBaseUrl: string;
  pob2Connected?: boolean;
  bridgeUrl?: string;
  importingCurrent?: boolean;
  onImportCurrent?: () => Promise<void>;
  onOpenImport?: () => void;
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

async function readErrorMessage(res: Response): Promise<string> {
  try {
    const body = (await res.json()) as { error?: unknown; detail?: unknown };
    if (typeof body.error === "string") return body.error;
    if (typeof body.detail === "string") return body.detail;
  } catch {}
  return `Compare failed with ${res.status}`;
}

interface CompareSummary {
  statsChanged: number;
  statsMatched: number;
  skills: number;
  items: number;
  nodesAdded: number;
  nodesRemoved: number;
}

function summarize(comparison: BuildCompareResult | null): CompareSummary {
  if (!comparison) return { statsChanged: 0, statsMatched: 0, skills: 0, items: 0, nodesAdded: 0, nodesRemoved: 0 };
  const statList = Array.isArray(comparison.statDiffs)
    ? comparison.statDiffs
    : comparison.statDiffs
      ? Object.values(comparison.statDiffs)
      : Array.isArray(comparison.defenses?.stats)
        ? comparison.defenses!.stats!
        : [];
  let statsChanged = 0;
  let statsMatched = 0;
  for (const stat of statList) {
    if (stat?.status === "unchanged" || stat?.changed === false) continue;
    if (stat?.near || stat?.status === "near") statsMatched += 1;
    else statsChanged += 1;
  }
  const skills = (comparison.skills?.rows ?? []).filter((r) => r.status !== "unchanged").length;
  const items = (comparison.items?.rows ?? []).filter((r) => r.status !== "unchanged").length;
  const nodesAdded = comparison.passiveTree?.addedNodeIds?.length ?? 0;
  const nodesRemoved = comparison.passiveTree?.removedNodeIds?.length ?? 0;
  return { statsChanged, statsMatched, skills, items, nodesAdded, nodesRemoved };
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
}: BuildCompareProps) {
  const buildIds = useMemo(() => builds.map((build) => build.snapshot_id), [builds]);
  const autoCompareKey = useRef("");
  const [baseId, setBaseId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [comparison, setComparison] = useState<BuildCompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const overviewRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const preferredBase = activeBuildId && buildIds.includes(activeBuildId) ? activeBuildId : buildIds[0] ?? "";
    setBaseId((current) => {
      if (activeBuildId && buildIds.includes(activeBuildId)) return activeBuildId;
      if (current && buildIds.includes(current)) return current;
      return preferredBase;
    });
    setTargetId((current) => {
      if (current && buildIds.includes(current) && current !== preferredBase) return current;
      return buildIds.find((id) => id !== preferredBase) ?? "";
    });
  }, [activeBuildId, buildIds]);

  const baseBuild = builds.find((build) => build.snapshot_id === baseId);
  const targetBuild = builds.find((build) => build.snapshot_id === targetId);
  const bothLoaded = Boolean(baseId) && Boolean(targetId) && baseId !== targetId;
  const canCompare = bothLoaded && !loading;
  const summary = useMemo(() => summarize(comparison), [comparison]);

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
      const data = (await res.json()) as BuildCompareResult;
      setComparison(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Compare failed");
    } finally {
      setLoading(false);
    }
  }

  const currentStep = !bothLoaded ? 1 : comparison ? 3 : 2;

  function scrollTo(ref: React.RefObject<HTMLDivElement | null>) {
    ref.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  return (
    <section className="compare-panel" aria-label="Build comparison">
      <div className="compare-header">
        <div>
          <h3>Compare &amp; copy a build</h3>
          <span className="compare-subtitle">Load your build and the build you want to copy, then work the swap checklist.</span>
        </div>
      </div>

      <ol className="compare-stepper" aria-label="Compare steps">
        <li className={currentStep >= 1 ? "step-active" : ""}>
          <button type="button" disabled>
            <span className="step-num">1</span> Load both builds
          </button>
        </li>
        <li className={currentStep >= 2 ? "step-active" : ""}>
          <button type="button" onClick={() => scrollTo(overviewRef)} disabled={!comparison}>
            <span className="step-num">2</span> See differences
          </button>
        </li>
        <li className={currentStep >= 3 ? "step-active" : ""}>
          <button type="button" onClick={() => scrollTo(detailRef)} disabled={!comparison}>
            <span className="step-num">3</span> Swap checklist
          </button>
        </li>
      </ol>

      {/* Step 1 — load both builds */}
      <div className="compare-stage">
        <div className={pob2Connected ? "bridge-card bridge-card-ok" : "bridge-card bridge-card-warn"}>
          <strong>{pob2Connected ? "Live PoB bridge connected" : "Live PoB bridge offline"}</strong>
          <span>
            {pob2Connected
              ? `Import your active PoB build directly${bridgeUrl ? ` from ${bridgeUrl}` : ""}.`
              : "Paste a PoB code or poe.ninja link for each side, or start the PoB bridge to import your live build."}
          </span>
        </div>

        <div className="compare-slots">
          <BuildSlot
            title="1. My build"
            hint="Your current character"
            value={baseId}
            options={builds}
            disabledOption={targetId}
            onChange={setBaseId}
            actions={
              <>
                {onImportCurrent && (
                  <button className="btn-secondary" onClick={onImportCurrent} disabled={!pob2Connected || importingCurrent}>
                    {importingCurrent ? "Importing PoB..." : "Import current PoB"}
                  </button>
                )}
                {onOpenImport && <button className="btn-secondary" onClick={onOpenImport}>Paste PoB / poe.ninja</button>}
              </>
            }
          />
          <BuildSlot
            title="2. Build to copy"
            hint="The guide / target build"
            value={targetId}
            options={builds}
            disabledOption={baseId}
            onChange={setTargetId}
            actions={onOpenImport && <button className="btn-secondary" onClick={onOpenImport}>Paste PoB / poe.ninja</button>}
          />
        </div>

        {builds.length < 2 && (
          <div className="compare-empty">
            Load at least two builds to compare. Import your build and the build you want to copy using the buttons above.
          </div>
        )}

        {bothLoaded && (
          <div className="compare-builds">
            <BuildSummaryCard title="My build" build={baseBuild} />
            <span className="compare-vs">vs</span>
            <BuildSummaryCard title="Build to copy" build={targetBuild} />
            <button className="btn-primary" onClick={runCompare} disabled={!canCompare}>
              {loading ? "Comparing..." : "Refresh compare"}
            </button>
          </div>
        )}
        {error && <div className="compare-error">{error}</div>}
      </div>

      {/* Step 2 — differences overview */}
      {comparison && (
        <div className="compare-stage" ref={overviewRef}>
          <h4 className="stage-title">Step 2 — What's different</h4>
          <div className="compare-scoreboard">
            <ScoreCard value={summary.statsChanged} label="stats differ" tone="changed" />
            <ScoreCard value={summary.statsMatched} label="stats matched" tone="matched" />
            <ScoreCard value={summary.skills} label="skill groups" tone="changed" />
            <ScoreCard value={summary.items} label="item slots" tone="changed" />
            <ScoreCard value={summary.nodesAdded} label="nodes to add" tone="added" />
            <ScoreCard value={summary.nodesRemoved} label="nodes to drop" tone="removed" />
          </div>
          <button className="btn-link" onClick={() => scrollTo(detailRef)}>See full swap checklist ↓</button>
        </div>
      )}

      {/* Step 3 — swap checklist */}
      <div className="compare-stage" ref={detailRef}>
        {loading && <div className="compare-hint">Comparing builds...</div>}
        {!loading && comparison && <DiffView diff={comparison} />}
        {!loading && !comparison && bothLoaded && <div className="compare-hint">Comparison will appear here.</div>}
      </div>
    </section>
  );
}

function BuildSlot({
  title,
  hint,
  value,
  options,
  disabledOption,
  onChange,
  actions,
}: {
  title: string;
  hint: string;
  value: string;
  options: BuildInfo[];
  disabledOption: string;
  onChange: (id: string) => void;
  actions?: React.ReactNode;
}) {
  return (
    <div className={`build-slot${value ? " build-slot-filled" : ""}`}>
      <div className="build-slot-head">
        <strong>{title}</strong>
        <span className="build-slot-hint">{hint}</span>
      </div>
      <select aria-label={title} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">— select a build —</option>
        {options.map((build) => (
          <option key={build.snapshot_id} value={build.snapshot_id} disabled={build.snapshot_id === disabledOption}>
            {buildLabel(build)}
          </option>
        ))}
      </select>
      {actions && <div className="build-slot-actions">{actions}</div>}
    </div>
  );
}

function BuildSummaryCard({ title, build }: { title: string; build: BuildInfo | undefined }) {
  return (
    <div className="compare-build-summary">
      <span className="compare-build-title">{title}</span>
      <strong>{build?.label ?? "No build selected"}</strong>
      <span>{[build?.character?.className, build?.character?.ascendancy].filter(Boolean).join(" / ") || "Unknown class"}</span>
      {build?.character?.level && <span>Level {build.character.level}</span>}
    </div>
  );
}

function ScoreCard({ value, label, tone }: { value: number; label: string; tone: "changed" | "matched" | "added" | "removed" }) {
  return (
    <div className={`score-card score-${tone}`}>
      <span className="score-value">{value}</span>
      <span className="score-label">{label}</span>
    </div>
  );
}
