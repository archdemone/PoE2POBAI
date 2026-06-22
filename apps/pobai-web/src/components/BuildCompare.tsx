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
  const canCompare = baseId.length > 0 && targetId.length > 0 && baseId !== targetId && !loading;

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

  return (
    <section className="compare-panel" aria-label="Build comparison">
      <div className="compare-header">
        <div>
          <h3>Build copy compare</h3>
          <span className="compare-subtitle">Compare your current build against the build you want to copy.</span>
        </div>
        <div className="compare-actions">
          {onImportCurrent && (
            <button className="btn-secondary" onClick={onImportCurrent} disabled={!pob2Connected || importingCurrent}>
              {importingCurrent ? "Importing PoB..." : "Import current PoB"}
            </button>
          )}
          {onOpenImport && <button className="btn-secondary" onClick={onOpenImport}>Paste guide build</button>}
        </div>
      </div>

      <div className={pob2Connected ? "bridge-card bridge-card-ok" : "bridge-card bridge-card-warn"}>
        <strong>{pob2Connected ? "Live PoB bridge connected" : "Live PoB bridge offline"}</strong>
        <span>
          {pob2Connected
            ? `Current PoB imports are available${bridgeUrl ? ` from ${bridgeUrl}` : ""}.`
            : "Paste PoB exports for now, or start the PoB bridge to import the active build directly."}
        </span>
      </div>

      {builds.length < 2 ? (
        <div className="compare-empty">
          Import your build and a guide build to get a side-by-side copy checklist.
        </div>
      ) : (
        <>
          <div className="compare-controls">
            <label>
              My build
              <select aria-label="Base build" value={baseId} onChange={(e) => setBaseId(e.target.value)}>
                {builds.map((build) => (
                  <option key={build.snapshot_id} value={build.snapshot_id}>{buildLabel(build)}</option>
                ))}
              </select>
            </label>
            <label>
              Build to copy
              <select aria-label="Target build" value={targetId} onChange={(e) => setTargetId(e.target.value)}>
                {builds.map((build) => (
                  <option key={build.snapshot_id} value={build.snapshot_id}>{buildLabel(build)}</option>
                ))}
              </select>
            </label>
            <button onClick={runCompare} disabled={!canCompare}>
              {loading ? "Comparing..." : "Refresh compare"}
            </button>
          </div>

          <div className="compare-builds">
            <BuildSummary title="My build" build={baseBuild} />
            <BuildSummary title="Build to copy" build={targetBuild} />
          </div>

          {error && <div className="compare-error">{error}</div>}
          {comparison ? <DiffView diff={comparison} /> : <div className="compare-hint">Comparison will appear here when both builds are selected.</div>}
        </>
      )}
    </section>
  );
}

function BuildSummary({ title, build }: { title: string; build: BuildInfo | undefined }) {
  return (
    <div className="compare-build-summary">
      <span className="compare-build-title">{title}</span>
      <strong>{build?.label ?? "No build selected"}</strong>
      <span>{[build?.character?.className, build?.character?.ascendancy].filter(Boolean).join(" / ") || "Unknown class"}</span>
      {build?.character?.level && <span>Level {build.character.level}</span>}
    </div>
  );
}
