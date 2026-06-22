import React, { useEffect, useState } from "react";

interface SettingsModalProps {
  open: boolean;
  apiKey: string;
  model: string;
  onClose: () => void;
  onSave: (apiKey: string, model: string) => void;
}

const MODEL_SUGGESTIONS = [
  "openai/gpt-4o-mini",
  "openai/gpt-4o",
  "anthropic/claude-3.5-sonnet",
  "google/gemini-2.0-flash-001",
  "meta-llama/llama-3.3-70b-instruct",
  "deepseek/deepseek-chat",
];

export function SettingsModal({ open, apiKey, model, onClose, onSave }: SettingsModalProps) {
  const [keyDraft, setKeyDraft] = useState(apiKey);
  const [modelDraft, setModelDraft] = useState(model);

  useEffect(() => {
    if (open) {
      setKeyDraft(apiKey);
      setModelDraft(model);
    }
  }, [open, apiKey, model]);

  if (!open) return null;

  const save = () => {
    onSave(keyDraft.trim(), modelDraft.trim() || "openai/gpt-4o-mini");
    onClose();
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-content" role="dialog" aria-modal="true" aria-label="Chat settings" onClick={(e) => e.stopPropagation()}>
        <h3>Chat settings</h3>

        <label className="settings-label" htmlFor="settings-api-key">OpenRouter API key</label>
        <input
          id="settings-api-key"
          type="password"
          className="import-label-input"
          placeholder="sk-or-v1-..."
          value={keyDraft}
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setKeyDraft(e.target.value)}
        />
        <span className="settings-hint">
          Stored only in this browser (localStorage) and sent to your local PoBAI server, which forwards it to OpenRouter.
          Leave blank to stay in local demo mode (no LLM calls).
        </span>

        <label className="settings-label" htmlFor="settings-model">Model</label>
        <input
          id="settings-model"
          className="import-label-input"
          list="settings-model-suggestions"
          placeholder="openai/gpt-4o-mini"
          value={modelDraft}
          onChange={(e) => setModelDraft(e.target.value)}
        />
        <datalist id="settings-model-suggestions">
          {MODEL_SUGGESTIONS.map((m) => <option key={m} value={m} />)}
        </datalist>
        <span className="settings-hint">Any OpenRouter model id. Tool-calling models (gpt-4o, claude-3.5-sonnet) work best for build questions.</span>

        <div className="modal-actions">
          {keyDraft && (
            <button className="btn-ghost" onClick={() => setKeyDraft("")}>Clear key</button>
          )}
          <button onClick={onClose}>Cancel</button>
          <button className="btn-primary" onClick={save}>Save</button>
        </div>
      </div>
    </div>
  );
}
