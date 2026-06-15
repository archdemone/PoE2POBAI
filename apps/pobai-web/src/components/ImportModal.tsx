import React, { useState } from "react";

interface ImportModalProps {
  open: boolean;
  onClose: () => void;
  onImport: (code: string, label: string, source: string) => Promise<void>;
}

function detectSource(text: string): string {
  const t = text.trim();
  if (t.startsWith("<") && /PathOfBuilding/i.test(t)) return "pob-xml";
  if (/^https?:\/\//i.test(t)) return "poe-ninja";
  return "pob-code";
}

export function ImportModal({ open, onClose, onImport }: ImportModalProps) {
  const [code, setCode] = useState("");
  const [label, setLabel] = useState("");
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!open) return null;

  const source = detectSource(code);
  const handleImport = async () => {
    if (!code.trim()) return;
    setImporting(true); setError(null);
    try { await onImport(code.trim(), label.trim(), source); setCode(""); setLabel(""); onClose(); }
    catch (e: any) { setError(e.message || "Import failed"); }
    finally { setImporting(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" onClick={(e) => e.stopPropagation()}>
        <h3>Import Build</h3>
        <textarea className="import-textarea" placeholder="Paste PoB export code, XML, or URL..."
          value={code} onChange={(e) => setCode(e.target.value)} disabled={importing} />
        <input className="import-label-input" placeholder="Label (optional)"
          value={label} onChange={(e) => setLabel(e.target.value)} disabled={importing} />
        {code && <div className="import-source">Detected: {source}</div>}
        {error && <div className="import-error">{error}</div>}
        <div className="modal-actions">
          <button onClick={onClose} disabled={importing}>Cancel</button>
          <button onClick={handleImport} disabled={importing || !code.trim()}>
            {importing ? "Importing..." : "Import"}
          </button>
        </div>
      </div>
    </div>
  );
}