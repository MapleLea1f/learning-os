import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const subcommand = process.argv[2];
const supportedCommands = new Set(["dev", "build", "start"]);

if (!supportedCommands.has(subcommand)) {
  throw new Error(`Unsupported Vinext command: ${subcommand}`);
}

const cliPath = fileURLToPath(new URL("../node_modules/vinext/dist/cli.js", import.meta.url));
const connectorPath = fileURLToPath(new URL("./learning-os-workspace.mjs", import.meta.url));
const connectorPort = Number(process.env.LEARNING_OS_CONNECTOR_PORT || 4317);

function readConnectorVersion() {
  try {
    const source = fs.readFileSync(connectorPath, "utf8");
    return source.match(/CONNECTOR_VERSION\s*=\s*"([^"]+)"/)?.[1] ?? "";
  } catch {
    return "";
  }
}

async function probeConnector(port) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 1500);
    const response = await fetch(`http://127.0.0.1:${port}/version`, { signal: controller.signal });
    clearTimeout(timer);
    if (!response.ok) return { running: true, version: null };
    const payload = await response.json().catch(() => ({}));
    return { running: true, version: typeof payload.version === "string" ? payload.version : null };
  } catch {
    return { running: false, version: null };
  }
}

function listenerOnPort(port) {
  try {
    const command = `$c = Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -First 1; if ($c) { $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)"; [PSCustomObject]@{ Pid = $c.OwningProcess; CommandLine = $p.CommandLine } | ConvertTo-Json -Compress }`;
    const out = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { encoding: "utf8", windowsHide: true }).trim();
    return out ? JSON.parse(out) : null;
  } catch {
    return null;
  }
}

async function ensureFreshConnector(port, version) {
  if (process.platform !== "win32") return;
  const probe = await probeConnector(port);
  if (!probe.running) return;
  const stale = probe.version === null || (version !== "" && probe.version !== version);
  if (!stale) return;
  const info = listenerOnPort(port);
  if (!info?.Pid || !/learning-os-workspace\.mjs/.test(info.CommandLine || "")) return;
  console.error(`[learning-os] 检测到旧版连接器（PID ${info.Pid}），正在重启以加载最新代码…`);
  try {
    execFileSync("taskkill.exe", ["/PID", String(info.Pid), "/F"], { windowsHide: true, stdio: "ignore" });
  } catch {
    return;
  }
  await new Promise((resolve) => setTimeout(resolve, 1000));
}

let connectorChild = null;
if (subcommand === "dev" || subcommand === "start") {
  await ensureFreshConnector(connectorPort, readConnectorVersion());
  connectorChild = spawn(process.execPath, [connectorPath, "serve"], { cwd: process.cwd(), stdio: "ignore", windowsHide: true, env: { ...process.env, LEARNING_OS_ROOT: process.env.LEARNING_OS_ROOT ?? process.cwd() } });
}

const child = spawn(process.execPath, [cliPath, subcommand], {
  stdio: "inherit",
  env: {
    ...process.env,
    WRANGLER_LOG_PATH: process.env.WRANGLER_LOG_PATH ?? ".wrangler/wrangler.log",
    LEARNING_OS_ROOT: process.env.LEARNING_OS_ROOT ?? process.cwd(),
  },
});

child.once("error", (error) => {
  console.error("Unable to start Vinext:", error.message);
  process.exit(1);
});

child.once("exit", (code, signal) => {
  connectorChild?.kill();
  if (signal) {
    process.exit(1);
  }

  process.exit(code ?? 1);
});
