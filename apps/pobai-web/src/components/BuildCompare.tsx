import React, { useEffect, useMemo, useRef, useState } from "react";
import { DiffView, type BuildCompareResult } from "./DiffView";
import { StatSheet } from "./StatSheet";
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
  // Tracks which build ids we've already seen so we can tell a *freshly imported*
  // build apart from ones that were already loaded.
  const seenBuildIds = useRef<Set<string>>(new Set());
  const [baseId, setBaseId] = useState("");
  const [targetId, setTargetId] = useState("");
  const [comparison, setComparison] = useState<BuildCompareResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const overviewRef = useRef<HTMLDivElement>(null);
  const detailRef = useRef<HTMLDivElement>(null);

  // Seed "My build" once from a valid current selection, else the active build,
  // else the first build. Crucially we KEEP an existing valid selection so that
  // importing a second build (which becomes the active build) does not hijack the
  // "My build" slot — the new build flows into "Build to copy" instead.
  useEffect(() => {
    setBaseId((current) => {
      if (current && buildIds.includes(current)) return current;
      if (activeBuildId && buildIds.includes(activeBuildId)) return activeBuildId;
      return buildIds[0] ?? "";
    });
  }, [activeBuildId, buildIds]);

  // "Build to copy" is the build you want to copy. A *freshly imported* build (it
  // becomes the active build) flows in here, even if a build was already selected —
  // that's what makes re-importing the guide build actually refresh this slot.
  // Otherwise we keep a valid manual choice, falling back to any non-base build.
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

  const baseBuild = builds.find((build) => build.snapshot_id === baseId);
  const targetBuild = builds.find((build) => build.snapshot_id === targetId);
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

      {/* Step 2 — character sheet overview */}
      {comparison && (
        <div className="compare-stage" ref={overviewRef}>
          <h4 className="stage-title">Step 2 — What's different</h4>
          <StatSheet diff={comparison} />
          <button className="btn-link" onClick={() => scrollTo(detailRef)}>See full swap checklist ↓</button>
        </div>
      )}

      {/* Step 3 — swap checklist */}
      <div className="compare-stage" ref={detailRef}>
        {loading && <div className="compare-hint">Comparing builds...</div>}
        {!loading && comparison && <DiffView diff={comparison} showStats={false} />}
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

