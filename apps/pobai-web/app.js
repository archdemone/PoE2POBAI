const sampleXml = `<PathOfBuilding2>
  <Build characterName="Demo Twister Ranger" className="Ranger" ascendClassName="Deadeye" level="72" league="Standard" />
  <Skills>
    <Skill label="Twister main setup" enabled="true" mainActiveSkill="Twister">
      <Gem nameSpec="Twister" level="18" enabled="true" />
      <Gem nameSpec="Trinity Support" level="17" support="true" enabled="true" />
      <Gem nameSpec="Added Fire Damage Support" level="17" support="true" enabled="true" />
    </Skill>
    <Skill label="Defensive spirit setup" enabled="true">
      <Gem nameSpec="Wind Dancer" level="12" enabled="true" />
    </Skill>
  </Skills>
  <Items>
    <Item id="1" slot="Weapon 1"><Name>Demo Fire Bow</Name><TypeLine>Expert Dualstring Bow</TypeLine></Item>
    <Item id="2" slot="Body Armour"><Name>Demo Evasion Coat</Name><TypeLine>Advanced Garment</TypeLine></Item>
  </Items>
  <PlayerStat stat="Life" value="1450" />
  <PlayerStat stat="Fire Resistance" value="72" />
  <PlayerStat stat="Cold Resistance" value="38" />
  <PlayerStat stat="Lightning Resistance" value="41" />
  <Tree treeVersion="demo"><Node id="101" /><Node id="102" /></Tree>
</PathOfBuilding2>`;

const state = {
  snapshot: null,
  snapshots: [],
  messages: [],
};

const elements = {
  status: document.querySelector("#status"),
  apiKey: document.querySelector("#apiKey"),
  model: document.querySelector("#model"),
  source: document.querySelector("#source"),
  label: document.querySelector("#label"),
  fileInput: document.querySelector("#fileInput"),
  payload: document.querySelector("#payload"),
  importButton: document.querySelector("#importButton"),
  sampleButton: document.querySelector("#sampleButton"),
  snapshotList: document.querySelector("#snapshotList"),
  snapshot: document.querySelector("#snapshot"),
  summary: document.querySelector("#summary"),
  noSnapshot: document.querySelector("#noSnapshot"),
  chatLog: document.querySelector("#chatLog"),
  draft: document.querySelector("#draft"),
  sendButton: document.querySelector("#sendButton"),
};

function setStatus(message) {
  elements.status.textContent = message;
}

function renderSnapshotList() {
  if (state.snapshots.length === 0) {
    elements.snapshotList.innerHTML = '<p class="muted">No persisted snapshots found.</p>';
    return;
  }

  elements.snapshotList.innerHTML = `
    <h3>Persisted snapshots</h3>
    ${state.snapshots.map((snapshot) => `
      <div class="snapshot-row ${state.snapshot?.id === snapshot.id ? "selected" : ""}">
        <button class="secondary select-snapshot" data-id="${escapeHtml(snapshot.id)}" type="button">
          ${escapeHtml(snapshot.label)}<br /><span>${escapeHtml(snapshot.source)} · ${new Date(snapshot.createdAt).toLocaleString()}</span>
        </button>
        <button class="danger delete-snapshot" data-id="${escapeHtml(snapshot.id)}" type="button">Delete</button>
      </div>
    `).join("")}
  `;

  for (const button of elements.snapshotList.querySelectorAll(".select-snapshot")) {
    button.addEventListener("click", () => selectSnapshot(button.dataset.id));
  }
  for (const button of elements.snapshotList.querySelectorAll(".delete-snapshot")) {
    button.addEventListener("click", () => deleteSnapshot(button.dataset.id));
  }
}

function renderSnapshot() {
  renderSnapshotList();
  if (!state.snapshot) {
    elements.snapshot.classList.add("hidden");
    elements.summary.classList.add("hidden");
    elements.noSnapshot.classList.remove("hidden");
    return;
  }

  elements.noSnapshot.classList.add("hidden");
  elements.snapshot.classList.remove("hidden");
  elements.snapshot.innerHTML = `
    <strong>${escapeHtml(state.snapshot.label)}</strong>
    <span>${escapeHtml(state.snapshot.source)} · ${state.snapshot.sizeBytes} bytes · ${state.snapshot.hash.slice(0, 12)}</span>
  `;
  renderSummary(state.snapshot.summary);
}

function renderSummary(summary) {
  if (!summary) {
    elements.summary.classList.add("hidden");
    return;
  }

  const characterRows = Object.entries(summary.character || {}).filter(([, value]) => value);
  const defenses = Object.entries(summary.defenses || {});
  const skills = summary.skills || [];
  const items = summary.items || [];
  const warnings = summary.warnings || [];

  elements.summary.classList.remove("hidden");
  elements.summary.innerHTML = `
    <h3>Parsed snapshot summary</h3>
    <div class="summary-grid">
      <div>${renderList("Character", characterRows.map(([key, value]) => `${labelize(key)}: ${value}`))}</div>
      <div>${renderList("Defense-like stats", defenses.map(([key, value]) => `${key}: ${value}`))}</div>
      <div>${renderList("Skills", skills.slice(0, 8).map((skill) => `${skill.label}: ${(skill.gems || []).map((gem) => gem.name).join(", ")}`))}</div>
      <div>${renderList("Items", items.slice(0, 8).map((item) => [item.slot, item.name, item.typeLine].filter(Boolean).join(": ")))}</div>
    </div>
    ${renderList("Warnings / missing source-of-truth data", warnings)}
  `;
}

function renderList(title, values) {
  const safeValues = values.filter(Boolean);
  if (safeValues.length === 0) return `<h4>${escapeHtml(title)}</h4><p class="muted">None found in this snapshot.</p>`;
  return `<h4>${escapeHtml(title)}</h4><ul>${safeValues.map((value) => `<li>${escapeHtml(value)}</li>`).join("")}</ul>`;
}

function renderEvidence(evidence) {
  if (!evidence) return "";
  return `
    <details class="evidence">
      <summary>Evidence and unavailable calculations</summary>
      ${renderList("Question type", [evidence.questionType])}
      ${renderList("Extracted from snapshot", evidence.extracted || [])}
      ${renderList("Unavailable until PoB/MCP bridge", evidence.unavailable || [])}
      ${renderList("Parser warnings", evidence.warnings || [])}
    </details>
  `;
}

function labelize(value) {
  return String(value).replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase());
}

function renderMessages() {
  if (state.messages.length === 0) {
    elements.chatLog.innerHTML = '<p class="muted">Ask a build-mechanics question after importing a snapshot.</p>';
    return;
  }

  elements.chatLog.innerHTML = state.messages.map((message) => `
    <article class="message ${message.role}">
      <strong>${escapeHtml(message.role)}</strong>
      <p>${escapeHtml(message.content)}</p>
      ${renderEvidence(message.evidence)}
    </article>
  `).join("");
  elements.chatLog.scrollTop = elements.chatLog.scrollHeight;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "'": "&#39;",
    '"': "&quot;",
  })[character]);
}

async function refreshSnapshots() {
  const response = await fetch("/api/build/current");
  if (!response.ok) {
    setStatus(`Could not load snapshots: ${await response.text()}`);
    return;
  }
  const data = await response.json();
  state.snapshots = data.snapshots || [];
  if (!state.snapshot && state.snapshots.length > 0) state.snapshot = state.snapshots[0];
  renderSnapshot();
}

function selectSnapshot(snapshotId) {
  const snapshot = state.snapshots.find((candidate) => candidate.id === snapshotId);
  if (!snapshot) return;
  state.snapshot = snapshot;
  renderSnapshot();
  setStatus(`Selected snapshot: ${snapshot.label}`);
}

async function deleteSnapshot(snapshotId) {
  const snapshot = state.snapshots.find((candidate) => candidate.id === snapshotId);
  if (!snapshot) return;
  const response = await fetch(`/api/build/${encodeURIComponent(snapshotId)}`, { method: "DELETE" });
  if (!response.ok) {
    setStatus(`Delete failed: ${await response.text()}`);
    return;
  }
  if (state.snapshot?.id === snapshotId) state.snapshot = null;
  await refreshSnapshots();
  setStatus(`Deleted snapshot: ${snapshot.label}`);
}

async function importBuild() {
  if (!elements.payload.value.trim()) {
    setStatus("Paste or load a PoB payload before importing.");
    return;
  }

  setStatus("Importing, parsing, and persisting snapshot...");
  const response = await fetch("/api/build/import", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      source: elements.source.value,
      label: elements.label.value || undefined,
      payload: elements.payload.value,
    }),
  });

  if (!response.ok) {
    setStatus(`Import failed: ${await response.text()}`);
    return;
  }

  const data = await response.json();
  state.snapshot = data.snapshot;
  state.snapshots = [data.snapshot, ...state.snapshots.filter((snapshot) => snapshot.id !== data.snapshot.id)];
  renderSnapshot();
  setStatus("Snapshot imported, parsed, and persisted. Re-import after manual PoB changes.");
}

async function sendMessage() {
  const draft = elements.draft.value.trim();
  const model = elements.model.value.trim();
  if (!draft || !model) {
    setStatus("Enter a model and message before sending.");
    return;
  }

  const userMessage = {
    id: crypto.randomUUID(),
    role: "user",
    content: draft,
    createdAt: new Date().toISOString(),
  };

  state.messages.push(userMessage);
  renderMessages();
  elements.draft.value = "";
  setStatus(elements.apiKey.value.trim() ? "Asking OpenRouter with snapshot context..." : "Using local grounded demo mode...");

  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      apiKey: elements.apiKey.value,
      model,
      snapshotId: state.snapshot?.id,
      messages: state.messages.map(({ role, content }) => ({ role, content })),
    }),
  });

  if (!response.ok) {
    setStatus(`Chat failed: ${await response.text()}`);
    return;
  }

  const data = await response.json();
  state.messages.push(data.message);
  renderMessages();
  setStatus("Ready");
}

elements.importButton.addEventListener("click", importBuild);
elements.sampleButton.addEventListener("click", () => {
  elements.source.value = "pob-xml";
  elements.label.value = "Demo Twister snapshot";
  elements.payload.value = sampleXml;
  setStatus("Sample XML loaded. Click import to parse it.");
});
elements.fileInput.addEventListener("change", async () => {
  const file = elements.fileInput.files?.[0];
  if (!file) return;
  elements.payload.value = await file.text();
  if (!elements.label.value) elements.label.value = file.name.replace(/\.[^.]+$/, "");
  elements.source.value = file.name.toLowerCase().endsWith(".xml") ? "pob-xml" : elements.source.value;
  setStatus(`Loaded file: ${file.name}. Click import to persist it.`);
});
elements.sendButton.addEventListener("click", sendMessage);
elements.draft.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
    sendMessage();
  }
});

renderSnapshot();
renderMessages();
refreshSnapshots();
