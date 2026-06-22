#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { access } from "node:fs/promises";
import { homedir, platform } from "node:os";
import { dirname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const DEFAULT_PORT = Number(process.env.POBAI_SERVER_PORT ?? process.env.PORT ?? 3001);

function printHelp() {
  console.log(`PoBAI launcher

Usage:
  node scripts/launch-pobai.mjs [options]
  start.bat [options]

Starts the PoBAI website/server, opens the compare view in your browser, and
launches Path of Building 2 when its executable can be found.

Options:
  --pob-exe "path"       Path to the PoB2 executable. Also reads POB2_EXE.
  --pob2-dir "path"      Path to the PoB2 install directory. Also reads POB2_DIR.
  --install-bridge       Patch PoB2 with the experimental live bridge before launch.
  --bridge-dry-run       Show what the bridge installer would patch, without editing PoB2.
  --server "url"         Website/API URL to open. Default: http://localhost:3001.
  --port 3001            Server port when this launcher starts PoBAI.
  --no-build             Skip rebuilding the web app.
  --no-browser           Do not open the website automatically.
  --no-pob               Do not try to launch Path of Building 2.
  --no-server            Do not start the PoBAI server; useful for checks.
  --help                 Show this help.

Examples:
  start.bat
  start.bat --pob-exe "C:\\PathOfBuilding2\\Path of Building.exe"
  start.bat --pob2-dir "C:\\PathOfBuilding2" --install-bridge

Environment:
  POB2_EXE               Preferred executable path for launching PoB2.
  POB2_DIR               Preferred install directory for bridge install and exe discovery.
  POBAI_SERVER_PORT      Local server port; defaults to 3001.
`);
}

const { values: args } = parseArgs({
  args: process.argv.slice(2),
  options: {
    "pob-exe": { type: "string" },
    "pob2-dir": { type: "string" },
    "install-bridge": { type: "boolean", default: false },
    "bridge-dry-run": { type: "boolean", default: false },
    server: { type: "string" },
    port: { type: "string" },
    "no-build": { type: "boolean", default: false },
    "no-browser": { type: "boolean", default: false },
    "no-pob": { type: "boolean", default: false },
    "no-server": { type: "boolean", default: false },
    help: { type: "boolean", default: false },
  },
  strict: false,
});

if (args.help) {
  printHelp();
  process.exit(0);
}

const port = Number(args.port ?? DEFAULT_PORT);
if (!Number.isInteger(port) || port <= 0) {
  console.error(`Invalid --port value: ${args.port}`);
  process.exit(1);
}

const serverUrl = args.server ?? `http://localhost:${port}`;
const pob2Dir = args["pob2-dir"] ?? process.env.POB2_DIR ?? process.env.POB2_INSTALL_DIR;
const pobExe = args["pob-exe"] ?? process.env.POB2_EXE;

function npmInvocation(commandArgs) {
  if (platform() === "win32") {
    return { command: "cmd", args: ["/c", "npm", ...commandArgs] };
  }
  return { command: "npm", args: commandArgs };
}

async function pathExists(path) {
  if (!path) return false;
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function candidateInstallDirs() {
  const home = homedir();
  const pf = process.env.ProgramW6432 || "C:\\Program Files";
  const pf86 = process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)";
  const localAppData = process.env.LOCALAPPDATA ?? join(home, "AppData", "Local");

  if (platform() === "win32") {
    return [
      join(localAppData, "PathOfBuilding2"),
      join(localAppData, "PathOfBuilding", "PoE2"),
      join(localAppData, "Programs", "PathOfBuilding2"),
      join(pf, "PathOfBuilding2"),
      join(pf, "PathOfBuilding", "PoE2"),
      join(pf86, "Steam", "steamapps", "common", "Path of Building 2"),
      join(pf86, "Steam", "steamapps", "common", "Path of Building PoE2"),
    ];
  }

  if (platform() === "darwin") {
    return [
      "/Applications/Path of Building 2.app/Contents/MacOS",
      join(home, "Applications", "Path of Building 2.app", "Contents", "MacOS"),
    ];
  }

  return [
    "/opt/PathOfBuilding2",
    join(home, ".local", "share", "PathOfBuilding2"),
  ];
}

function candidateExecutables(dir) {
  if (!dir) return [];
  if (platform() === "win32") {
    return [
      "Path of Building.exe",
      "Path of Building 2.exe",
      "PathOfBuilding.exe",
      "PathOfBuilding2.exe",
      "Path of Building Community.exe",
    ].map((name) => join(dir, name));
  }

  if (platform() === "darwin") {
    return [
      join(dir, "Path of Building 2"),
      join(dir, "Path of Building"),
    ];
  }

  return [
    join(dir, "PathOfBuilding2"),
    join(dir, "PathOfBuilding"),
    join(dir, "pathofbuilding2"),
  ];
}

async function findPobExecutable() {
  if (pobExe && await pathExists(pobExe)) return pobExe;

  const dirs = [
    pob2Dir,
    ...candidateInstallDirs(),
  ].filter(Boolean);

  for (const dir of dirs) {
    if (existsSync(dir) && dir.toLowerCase?.().endsWith(".exe")) {
      return dir;
    }
    for (const candidate of candidateExecutables(dir)) {
      if (await pathExists(candidate)) return candidate;
    }
  }
  return null;
}

function runInherited(command, commandArgs, options = {}) {
  return new Promise((resolveRun, rejectRun) => {
    const child = spawn(command, commandArgs, {
      cwd: ROOT,
      env: process.env,
      stdio: "inherit",
      shell: false,
      ...options,
    });
    child.on("error", rejectRun);
    child.on("exit", (code) => {
      if (code === 0) resolveRun();
      else rejectRun(new Error(`${command} ${commandArgs.join(" ")} exited with ${code}`));
    });
  });
}

async function isServerHealthy() {
  try {
    const response = await fetch(`${serverUrl.replace(/\/$/, "")}/health`, {
      signal: AbortSignal.timeout(1000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer() {
  const startedAt = Date.now();
  while (Date.now() - startedAt < 15000) {
    if (await isServerHealthy()) return true;
    await new Promise((resolveWait) => setTimeout(resolveWait, 500));
  }
  return false;
}

function openBrowser(url) {
  const child = platform() === "win32"
    ? spawn("cmd", ["/c", "start", "", url], { detached: true, stdio: "ignore" })
    : platform() === "darwin"
      ? spawn("open", [url], { detached: true, stdio: "ignore" })
      : spawn("xdg-open", [url], { detached: true, stdio: "ignore" });
  child.on("error", () => {});
  child.unref();
}

async function launchPob() {
  const executable = await findPobExecutable();
  if (!executable) {
    console.log("PoB2 executable not found. Set POB2_EXE or pass --pob-exe to launch it automatically.");
    return;
  }

  console.log(`Launching PoB2: ${executable}`);
  const child = spawn(executable, [], {
    cwd: dirname(executable),
    detached: true,
    stdio: "ignore",
  });
  child.on("error", (error) => {
    console.log(`Could not launch PoB2 automatically: ${error.message}`);
  });
  child.unref();
}

async function maybeInstallBridge() {
  if (!args["install-bridge"] && !args["bridge-dry-run"]) return;

  const bridgeArgs = ["integrations/pob2-addon/install-bridge.mjs"];
  if (pob2Dir) bridgeArgs.push("--pob2-dir", pob2Dir);
  if (args["bridge-dry-run"]) bridgeArgs.push("--dry-run");

  console.log(args["bridge-dry-run"] ? "Checking PoB2 bridge patch..." : "Installing PoB2 bridge patch...");
  try {
    await runInherited(process.execPath, bridgeArgs);
  } catch (error) {
    console.log(`Bridge installer did not complete: ${error.message}`);
    console.log("Continuing with website launch; bridge setup can be retried later.");
  }
}

let serverProcess = null;

function stopServerAndExit(code = 0) {
  if (serverProcess && !serverProcess.killed) {
    serverProcess.kill("SIGINT");
  }
  process.exit(code);
}

process.on("SIGINT", () => stopServerAndExit(0));
process.on("SIGTERM", () => stopServerAndExit(0));

console.log("\nPoBAI launcher");
console.log("---------------");
console.log(`Website/API: ${serverUrl}`);

await maybeInstallBridge();

if (!args["no-build"]) {
  console.log("\nBuilding website...");
  const npm = npmInvocation(["run", "build", "--workspace", "apps/pobai-web"]);
  await runInherited(npm.command, npm.args);
}

if (!args["no-server"]) {
  if (await isServerHealthy()) {
    console.log("PoBAI server is already running.");
  } else {
    console.log("\nStarting PoBAI server...");
    serverProcess = spawn(process.execPath, ["apps/pobai-server/src/index.mjs"], {
      cwd: ROOT,
      env: {
        ...process.env,
        POBAI_SERVER_PORT: String(port),
      },
      stdio: "inherit",
    });
    serverProcess.on("error", (error) => {
      console.error(`Could not start PoBAI server: ${error.message}`);
      stopServerAndExit(1);
    });

    if (!await waitForServer()) {
      console.error(`PoBAI server did not become healthy at ${serverUrl}/health`);
      stopServerAndExit(1);
    }
    console.log("PoBAI server is ready.");
  }
}

if (!args["no-browser"]) {
  console.log(`Opening website: ${serverUrl}`);
  openBrowser(serverUrl);
}

if (!args["no-pob"]) {
  await launchPob();
}

if (serverProcess) {
  console.log("\nPress Ctrl+C to stop PoBAI.");
  await new Promise((resolveExit) => {
    serverProcess.on("exit", (code) => {
      process.exitCode = code ?? 0;
      resolveExit();
    });
  });
}
