import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { execFile, execFileSync, spawnSync } from "node:child_process";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";

const stateRoot = path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), "AppData", "Local"), "LearningOS");
const statePath = path.join(stateRoot, "connector-state.json");
const configPath = path.join(stateRoot, "connector-config.json");

function parseArgs(argv) {
  const values = {};
  let command = "";
  let subcommand = "";
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value.startsWith("--")) {
      const key = value.slice(2);
      values[key] = argv[index + 1]?.startsWith("--") ? true : (argv[index + 1] ?? true);
      if (values[key] !== true) index += 1;
    } else if (!command) command = value;
    else if (!subcommand) subcommand = value;
  }
  return { command, subcommand, values };
}

function loadJson(file, fallback) {
  if (!fs.existsSync(file)) return fallback;
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function saveJson(file, value) {
  fs.mkdirSync(stateRoot, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(value, null, 2), "utf8");
}

function loadState() {
  return { workspaces: [], tasks: [], executions: [], steps: [], events: [], evidence: [], ...loadJson(statePath, {}) };
}

function loadConfig() {
  return loadJson(configPath, null);
}

function id(prefix) {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function absolute(value) {
  return path.resolve(value || process.cwd());
}

function currentWorkspace(state, cwd) {
  const root = absolute(cwd);
  return state.workspaces
    .filter((workspace) => root === workspace.root || root.startsWith(`${workspace.root}${path.sep}`))
    .sort((left, right) => right.root.length - left.root.length)[0] ?? null;
}

function output(value) {
  process.stdout.write(`${JSON.stringify(value, null, 2)}
`);
}

function runGit(root, args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
}

async function collectGitCommits(workspace, state, config, since = "") {
  let raw = "";
  try {
    raw = runGit(workspace.root, ["log", "-n", "30", "--format=%H%x1f%aI%x1f%an%x1f%s", ...(since ? ["--since=" + since] : [])]);
  } catch { return { scanned: false, added: 0 }; }
  const known = new Set(state.evidence.filter((item) => item.workspaceId === workspace.id).map((item) => item.sourceKey));
  const commits = raw.split(/\r?\n/).filter(Boolean).map((line) => {
    const [hash, observedAt, author, subject] = line.split("\x1f");
    return { hash, observedAt, author, subject };
  });
  let added = 0;
  for (const commit of commits.reverse()) {
    if (!commit.hash || known.has(commit.hash)) continue;
    let files = [];
    try { files = runGit(workspace.root, ["show", "--format=", "--name-only", commit.hash]).split(/\r?\n/).filter(Boolean); } catch {}
    const evidence = { workspace_id: workspace.id, user_id: config?.userId, evidence_type: "git_commit", title: commit.subject || commit.hash.slice(0, 8), content: commit.author + " 路 " + commit.hash.slice(0, 8), source_key: commit.hash, metadata: { commit: commit.hash, author: commit.author, files }, observed_at: commit.observedAt || new Date().toISOString() };
    const local = { id: id("local-evidence"), workspaceId: workspace.id, sourceKey: commit.hash, ...evidence, createdAt: new Date().toISOString() };
    const result = await writeCloudOrQueue(state, config, "workspace_evidence", "POST", evidence);
    state.evidence.push(local);
    known.add(commit.hash);
    added += 1;
    if (result.queued) local.queuedForCloudSync = true;
  }
  if (added) saveJson(statePath, state);
  return { scanned: true, added };
}

function readEnv(cwd) {
  const candidates = [cwd, process.env.LEARNING_OS_ROOT, process.env.INIT_CWD, process.cwd()].filter(Boolean);
  const visited = new Set();
  for (const candidate of candidates) {
    const envPath = path.join(absolute(candidate), ".env.local");
    if (visited.has(envPath)) continue;
    visited.add(envPath);
    if (!fs.existsSync(envPath)) continue;
    return Object.fromEntries(fs.readFileSync(envPath, "utf8").split(/\r?\n/).filter((line) => line && !line.trim().startsWith("#")).map((line) => {
      const separator = line.indexOf("=");
      return separator < 0 ? [line.trim(), ""] : [line.slice(0, separator).trim(), line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "")];
    }));
  }
  return {};
}

function normalizeCode(value) {
  return String(value || "").replaceAll("-", "").trim().toUpperCase();
}

async function refreshAccessToken(config) {
  if (!config?.refreshToken) throw new Error("Connector token expired and no refresh token is available. Reconnect the local connector.");
  const response = await fetch(`${config.supabaseUrl}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: { apikey: config.anonKey, "Content-Type": "application/json" },
    body: JSON.stringify({ refresh_token: config.refreshToken }),
  });
  if (!response.ok) throw new Error(`Token refresh failed with ${response.status}: ${(await response.text()).slice(0, 200)}`);
  const result = await response.json();
  if (!result?.access_token) throw new Error("Token refresh returned no access token.");
  const updated = { ...config, accessToken: result.access_token, refreshToken: result.refresh_token || config.refreshToken };
  saveJson(configPath, updated);
  return updated;
}

async function restRequest(config, resource, options = {}) {
  if (!config?.supabaseUrl || !config?.anonKey || !config?.accessToken) throw new Error("Connector is not paired.");
  const execute = async (token) => fetch(`${config.supabaseUrl}/rest/v1/${resource}`, {
    ...options,
    headers: {
      apikey: config.anonKey,
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      Prefer: "return=representation",
      ...(options.headers || {}),
    },
  });
  let response = await execute(config.accessToken);
  if (response.status === 401) {
    const errorText = await response.text();
    if (errorText.includes("JWT expired")) {
      const refreshed = await refreshAccessToken(config);
      config.accessToken = refreshed.accessToken;
      config.refreshToken = refreshed.refreshToken;
      response = await execute(config.accessToken);
    } else {
      throw new Error(`Supabase returned 401: ${errorText.slice(0, 300)}`);
    }
  }
  if (!response.ok) throw new Error(`Supabase returned ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function exchangePairing(values) {
  const cwd = values.cwd || process.cwd();
  const env = readEnv(cwd);
  const supabaseUrl = values["supabase-url"] || env.NEXT_PUBLIC_SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = values["anon-key"] || env.NEXT_PUBLIC_SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) throw new Error("Supabase URL and anon key are required. Put them in .env.local or pass --supabase-url and --anon-key.");
  const response = await fetch(`${supabaseUrl}/rest/v1/rpc/exchange_connector_pairing`, {
    method: "POST",
    headers: { apikey: anonKey, Authorization: `Bearer ${anonKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ input_code: normalizeCode(values.code) }),
  });
  if (!response.ok) throw new Error(`Pairing exchange failed with ${response.status}: ${(await response.text()).slice(0, 300)}`);
  const result = await response.json();
  if (!result?.ok) throw new Error(result?.error || "Invalid or expired pairing code.");
  const config = { supabaseUrl, anonKey, accessToken: result.access_token, refreshToken: result.refresh_token || null, userId: result.user_id, workspaceId: result.workspace_id, connectedAt: new Date().toISOString() };
  saveJson(configPath, config);
  return config;
}

function queueEvent(state, event) {
  state.events.push({ ...event, id: id("event"), createdAt: new Date().toISOString() });
  saveJson(statePath, state);
}

async function writeCloudOrQueue(state, config, resource, method, body, query = "") {
  try {
    const data = await restRequest(config, `${resource}${query}`, { method, body: body ? JSON.stringify(body) : undefined });
    return { data, queued: false };
  } catch (error) {
    queueEvent(state, { resource, method, body, query, error: error instanceof Error ? error.message : "unknown error" });
    return { data: null, queued: true, error: error instanceof Error ? error.message : "unknown error" };
  }
}

async function syncQueue(state, config) {
  const remaining = [];
  let synced = 0;
  for (const event of state.events) {
    try {
      await restRequest(config, `${event.resource}${event.query || ""}`, { method: event.method, body: event.body ? JSON.stringify(event.body) : undefined });
      synced += 1;
    } catch (error) {
      remaining.push({ ...event, error: error instanceof Error ? error.message : "unknown error" });
    }
  }
  state.events = remaining;
  saveJson(statePath, state);
  return { synced, pending: remaining.length };
}

async function updateLinkedTask(state, config, taskId, status) {
  if (!taskId) return { queued: false, skipped: true };
  const changes = { status, updated_at: new Date().toISOString() };
  const result = await writeCloudOrQueue(state, config, "workspace_tasks", "PATCH", changes, `?id=eq.${taskId}`);
  state.tasks = state.tasks.map((task) => task.id === taskId ? { ...task, ...changes, updatedAt: changes.updated_at } : task);
  saveJson(statePath, state);
  return { queued: result.queued, skipped: false };
}
async function connectWorkspace(values) {
  const state = loadState();
  const config = await exchangePairing(values);
  const cwd = values.cwd || process.cwd();
  const root = absolute(cwd);
  const workspace = { id: config.workspaceId, root, name: values.name || path.basename(root), createdAt: new Date().toISOString() };
  state.workspaces = state.workspaces.filter((item) => item.id !== workspace.id && item.root !== workspace.root);
  state.workspaces.push(workspace);
  saveJson(statePath, state);
  return { ok: true, workspace, connectedAt: config.connectedAt, statePath, configPath };
}

function disconnectWorkspace(values) {
  const state = loadState();
  const config = loadConfig();
  const workspaceToDisconnect = currentWorkspace(state, values.cwd || process.cwd());
  state.workspaces = state.workspaces.filter((item) => item.id !== workspaceToDisconnect?.id);
  if (workspaceToDisconnect && config?.workspaceId === workspaceToDisconnect.id) {
    if (fs.existsSync(configPath)) fs.unlinkSync(configPath);
  }
  saveJson(statePath, state);
  return { ok: true, disconnected: workspaceToDisconnect, statePath, configPath };
}

let oneCommanderCache = { exe: null, at: 0 };

function detectOneCommander() {
  if (process.platform !== "win32") return null;
  const now = Date.now();
  if (oneCommanderCache.exe && now - oneCommanderCache.at < 60_000 && fs.existsSync(oneCommanderCache.exe)) {
    return oneCommanderCache.exe;
  }
  let exe = null;
  try {
    // 注册表查询约 100ms，One Commander 注册为默认打开方式时会写入该键。
    const out = execFileSync("reg.exe", ["query", "HKCU\\Software\\Classes\\Directory\\shell\\OpenInOneCommander\\command", "/ve"], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "ignore"] });
    const match = out.match(/REG_SZ\s+(?:"([^"]+)"|([^\s]+))/);
    if (match) exe = (match[1] || match[2] || "").trim();
  } catch {}
  if (!exe || !fs.existsSync(exe)) {
    try {
      exe = execFileSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", "(Get-Process OneCommander -ErrorAction SilentlyContinue | Select-Object -First 1).Path"], { encoding: "utf8", windowsHide: true }).trim() || null;
    } catch {
      exe = null;
    }
  }
  if (exe && fs.existsSync(exe)) {
    oneCommanderCache = { exe, at: now };
    return exe;
  }
  return null;
}

async function openInExplorer(target) {
  if (process.platform !== "win32") throw new Error("打开本地文件夹仅支持 Windows。");
  const resolved = absolute(target);
  const stats = fs.statSync(resolved);
  const isDirectory = stats.isDirectory();
  const oneCommander = detectOneCommander();
  if (oneCommander) {
    // One Commander 单实例：用 -o 打开路径、-newtab 新建标签页。
    // 直接等待 exe 退出可能因 One Commander 正忙而阻塞很久；带 8 秒超时，
    // 超时说明请求已转发（One Commander 日志会出现 Started again），按成功处理。
    const openTarget = isDirectory ? resolved : path.dirname(resolved);
    const command = `& '${oneCommander.replace(/'/g, "''")}' -o '${openTarget.replace(/'/g, "''")}' -newtab`;
    const result = spawnSync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", command], { cwd: path.dirname(oneCommander), windowsHide: true, stdio: "ignore", timeout: 8_000 });
    if (!result.error || result.error?.code === "ETIMEDOUT") {
      return { path: resolved, kind: isDirectory ? "directory" : "file", openedWith: "OneCommander" };
    }
  }
  // 回退：交给系统默认文件管理器，或使用资源管理器选中文件。
  const args = isDirectory ? [resolved] : ["/select,", resolved];
  const result = spawnSync("explorer.exe", args, { windowsHide: true, stdio: "ignore" });
  if (result.error) throw result.error;
  return { path: resolved, kind: isDirectory ? "directory" : "file", openedWith: "Explorer" };
}

async function pickLocalPath(kind) {
  if (process.platform !== "win32") throw new Error("本机文件选择器目前只支持 Windows。");
  // 用置顶的隐形宿主窗体作为 Owner，保证选择框弹出时位于前台，不会藏在其他窗口后面。
  const pick = kind === "file"
    ? "$dialog = New-Object System.Windows.Forms.OpenFileDialog; $dialog.Title = '选择文件'; $dialog.Multiselect = $false; if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.FileName }"
    : "$dialog = New-Object System.Windows.Forms.FolderBrowserDialog; $dialog.Description = '选择文件夹'; if ($dialog.ShowDialog($owner) -eq [System.Windows.Forms.DialogResult]::OK) { Write-Output $dialog.SelectedPath }";
  const owner = "Add-Type -AssemblyName System.Windows.Forms; $owner = New-Object System.Windows.Forms.Form; $owner.TopMost = $true; $owner.ShowInTaskbar = $false; $owner.Opacity = 0; $owner.StartPosition = 'CenterScreen'; $owner.Show()";
  const selected = execFileSync("powershell.exe", ["-NoProfile", "-STA", "-Command", `${owner}; ${pick}; $dialog.Dispose(); $owner.Dispose()`], { encoding: "utf8", windowsHide: true }).trim();
  return selected || null;
}
function readHttpBody(request) {
  return new Promise((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => { body += chunk; });
    request.on("end", () => {
      try { resolve(body ? JSON.parse(body) : {}); } catch (error) { reject(error); }
    });
    request.on("error", reject);
  });
}

function writeHttpJson(response, status, payload) {
  response.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
    "Content-Type": "application/json; charset=utf-8",
  });
  response.end(JSON.stringify(payload));
}

function commandArgs(body) {
  const args = [];
  if (body.command) args.push(String(body.command));
  if (body.subcommand) args.push(String(body.subcommand));
  for (const [key, value] of Object.entries(body.values || {})) {
    if (value === true) args.push(`--${key}`);
    else args.push(`--${key}`, String(value));
  }
  return args;
}

async function runConnectorCommand(body) {
  const script = fileURLToPath(import.meta.url);
  const args = commandArgs(body);
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [script, ...args], { cwd: path.dirname(script), windowsHide: true, timeout: 60_000 }, (error, stdout, stderr) => {
      if (error) {
        const message = (stderr || error.message || "").trim() || "Connector command failed.";
        reject(new Error(message));
        return;
      }
      try { resolve({ ok: true, result: JSON.parse(stdout) }); }
      catch { resolve({ ok: true, result: stdout.trim() }); }
    });
  });
}

async function startConnectorServer(values) {
  const port = Number(values.port || process.env.LEARNING_OS_CONNECTOR_PORT || 4317);
  const server = createServer(async (request, response) => {
    if (request.method === "OPTIONS") { writeHttpJson(response, 204, {}); return; }
    try {
      if (request.method === "GET" && request.url?.startsWith("/status")) {
        const url = new URL(request.url, `http://127.0.0.1:${port}`);
        const state = loadState();
        const config = loadConfig();
        writeHttpJson(response, 200, { ok: true, workspace: currentWorkspace(state, url.searchParams.get("cwd") || process.cwd()), paired: Boolean(config?.accessToken), statePath });
        return;
      }
      const pathname = new URL(request.url || "/", `http://127.0.0.1:${port}`).pathname;
      if (request.method !== "POST" || !["/connect", "/disconnect", "/open", "/pick", "/command"].includes(pathname)) {
        writeHttpJson(response, 404, { error: "Not found." });
        return;
      }
      const valuesFromRequest = await readHttpBody(request);
      let result;
      if (pathname === "/connect") result = await connectWorkspace(valuesFromRequest);
      else if (pathname === "/disconnect") result = disconnectWorkspace(valuesFromRequest);
      else if (pathname === "/open") result = { ok: true, opened: await openInExplorer(valuesFromRequest.path) };
      else if (pathname === "/pick") result = { ok: true, path: await pickLocalPath(valuesFromRequest.kind === "file" ? "file" : "directory") };
      else result = await runConnectorCommand(valuesFromRequest);
      writeHttpJson(response, 200, result);
    } catch (error) {
      writeHttpJson(response, 500, { error: error instanceof Error ? error.message : String(error) });
    }
  });
  await new Promise((resolve, reject) => {
    server.once("error", (error) => {
      if (error?.code === "EADDRINUSE") {
        output({ ok: true, alreadyRunning: true, listening: `http://127.0.0.1:${port}` });
        process.exit(0);
      }
      reject(error);
    });
    server.listen(port, "127.0.0.1", resolve);
  });
  output({ ok: true, listening: `http://127.0.0.1:${port}`, statePath, configPath });
  await new Promise(() => {});
}
async function main() {
  const { command, subcommand, values } = parseArgs(process.argv.slice(2));
  const state = loadState();
  let config = loadConfig();
  const cwd = values.cwd || process.cwd();

  if (command === "serve") {
    await startConnectorServer(values);
    return;
  }

  if (command === "connect") {
    output(await connectWorkspace(values));
    return;
  }

  if (command === "register") {
    const workspace = { id: values.id || id("workspace"), root: absolute(values.root), name: values.name || path.basename(absolute(values.root)), createdAt: new Date().toISOString() };
    state.workspaces = state.workspaces.filter((item) => item.root !== workspace.root);
    state.workspaces.push(workspace);
    saveJson(statePath, state);
    output({ ok: true, workspace, statePath });
    return;
  }

  if (command === "current") {
    output({ workspace: currentWorkspace(state, cwd), cwd: absolute(cwd), paired: Boolean(config?.accessToken), statePath });
    return;
  }

  if (command === "disconnect") {
    output(disconnectWorkspace(values));
    return;
  }
  if (command === "sync") {
    if (!config?.accessToken) throw new Error("Connector is not paired.");
    output({ ok: true, ...await syncQueue(state, config), statePath });
    return;
  }

  const workspace = currentWorkspace(state, cwd);
  if (!workspace) throw new Error("No Learning OS workspace matches the current directory.");
  if (config?.workspaceId && config.workspaceId !== workspace.id) throw new Error("Current directory maps to a different workspace than the paired connector.");

  if (command === "evidence" && subcommand === "create") {
    const evidenceType = values.type || "command";
    if (!["file", "command", "test"].includes(evidenceType)) throw new Error("--type must be file, command, or test.");
    const title = values.title || "Workspace evidence";
    const content = values.content || "";
    if (!content) throw new Error("--content is required.");
    const sourceKey = values["source-key"] || id("manual-evidence");
    const evidence = { workspace_id: workspace.id, user_id: config?.userId, evidence_type: evidenceType, title, content, source_key: sourceKey, metadata: { source: "codex-skill" }, observed_at: new Date().toISOString() };
    const result = await writeCloudOrQueue(state, config, "workspace_evidence", "POST", evidence);
    const localEvidence = result.data?.[0] || { id: id("local-evidence"), workspaceId: workspace.id, sourceKey, ...evidence, createdAt: new Date().toISOString() };
    state.evidence = [...state.evidence.filter((item) => item.sourceKey !== sourceKey), localEvidence];
    saveJson(statePath, state);
    output({ ok: true, evidence: localEvidence, source: result.queued ? "local_queue" : "cloud", queuedForCloudSync: result.queued, pending: state.events.length, statePath });
    return;
  }
  if (command === "evidence" && subcommand === "list") {
    try {
      const evidence = await restRequest(config, `workspace_evidence?workspace_id=eq.${workspace.id}&select=*&order=observed_at.desc`);
      state.evidence = evidence;
      saveJson(statePath, state);
      output({ workspace, evidence, source: "cloud", pending: state.events.length, statePath });
    } catch {
      output({ workspace, evidence: state.evidence.filter((item) => item.workspaceId === workspace.id), source: "local_queue", pending: state.events.length, statePath });
    }
    return;
  }

  if (command === "evidence" && subcommand === "scan") {
    const result = await collectGitCommits(workspace, state, config, values.since || "");
    output({ ok: true, workspace, ...result, pending: state.events.length, statePath });
    return;
  }

  if (command === "watch") {
    const interval = Math.max(5000, Number(values.interval || 15000));
    let stopped = false;
    const stop = () => { stopped = true; output({ ok: true, stopped: true, statePath }); };
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    output({ ok: true, watching: workspace.root, interval, statePath });
    while (!stopped) {
      await collectGitCommits(workspace, state, config);
      if (config?.accessToken && state.events.length) await syncQueue(state, config);
      await new Promise((resolve) => setTimeout(resolve, interval));
    }
    return;
  }
  if (command === "task" && subcommand === "list") {
    try {
      const tasks = await restRequest(config, `workspace_tasks?workspace_id=eq.${workspace.id}&select=*&order=updated_at.desc`);
      state.tasks = tasks;
      saveJson(statePath, state);
      output({ workspace, tasks, source: "cloud", pending: state.events.length, statePath });
    } catch {
      output({ workspace, tasks: state.tasks.filter((task) => task.workspaceId === workspace.id), source: "local_queue", pending: state.events.length, statePath });
    }
    return;
  }

  if (command === "task" && subcommand === "create") {
    const task = { workspace_id: workspace.id, user_id: config?.userId, title: values.title || "", priority: values.priority || "medium", status: "todo", source: values.source || "skill", due_date: values["due-date"] || null };
    if (!task.title) throw new Error("--title is required.");
    const result = await writeCloudOrQueue(state, config, "workspace_tasks", "POST", task);
    const localTask = result.data?.[0] || { id: id("local-task"), workspaceId: workspace.id, ...task, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    state.tasks = [...state.tasks.filter((item) => item.id !== localTask.id), localTask];
    saveJson(statePath, state);
    output({ ok: true, task: localTask, source: result.queued ? "local_queue" : "cloud", queuedForCloudSync: result.queued, pending: state.events.length, statePath });
    return;
  }

  if (command === "task" && subcommand === "update") {
    const changes = {};
    if (values.title) changes.title = values.title;
    if (values.status) changes.status = values.status;
    if (values.priority) changes.priority = values.priority;
    changes.updated_at = new Date().toISOString();
    const result = await writeCloudOrQueue(state, config, "workspace_tasks", "PATCH", changes, `?id=eq.${values.id}`);
    state.tasks = state.tasks.map((task) => task.id === values.id ? { ...task, ...changes, updatedAt: changes.updated_at } : task);
    saveJson(statePath, state);
    output({ ok: true, taskId: values.id, source: result.queued ? "local_queue" : "cloud", queuedForCloudSync: result.queued, pending: state.events.length, statePath });
    return;
  }

  if (command === "execution" && subcommand === "start") {
    const taskId = values.task || values["task-id"] || null;
    const execution = { workspace_id: workspace.id, user_id: config?.userId, task_id: taskId, title: values.title || "Current execution", status: "in_progress", started_at: new Date().toISOString() };
    const result = await writeCloudOrQueue(state, config, "workspace_executions", "POST", execution);
    const localExecution = result.data?.[0] || { id: id("local-execution"), workspaceId: workspace.id, taskId, ...execution, startedAt: execution.started_at, finishedAt: null };
    state.executions.push(localExecution);
    const linkedTask = await updateLinkedTask(state, config, taskId, "in_progress");
    saveJson(statePath, state);
    output({ ok: true, execution: localExecution, linkedTask, source: result.queued ? "local_queue" : "cloud", queuedForCloudSync: result.queued || linkedTask.queued, pending: state.events.length, statePath });
    return;
  }

  if (command === "step" && subcommand === "create") {
    const execution = state.executions.find((item) => item.id === values.execution);
    if (!execution) throw new Error(`Execution not found: ${values.execution}`);
    const step = { execution_id: execution.id, workspace_id: workspace.id, user_id: config?.userId, title: values.title || "", status: "pending", position: Number(values.position || state.steps.filter((item) => item.executionId === execution.id).length) };
    if (!step.title) throw new Error("--title is required.");
    const result = await writeCloudOrQueue(state, config, "workspace_execution_steps", "POST", step);
    const localStep = result.data?.[0] || { id: id("local-step"), executionId: execution.id, ...step, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    state.steps.push(localStep);
    saveJson(statePath, state);
    output({ ok: true, step: localStep, source: result.queued ? "local_queue" : "cloud", queuedForCloudSync: result.queued, pending: state.events.length, statePath });
    return;
  }

  if (command === "step" && subcommand === "update") {
    const changes = { status: values.status || "pending", updated_at: new Date().toISOString() };
    const result = await writeCloudOrQueue(state, config, "workspace_execution_steps", "PATCH", changes, `?id=eq.${values.id}`);
    state.steps = state.steps.map((step) => step.id === values.id ? { ...step, ...changes, updatedAt: changes.updated_at } : step);
    saveJson(statePath, state);
    output({ ok: true, stepId: values.id, source: result.queued ? "local_queue" : "cloud", queuedForCloudSync: result.queued, pending: state.events.length, statePath });
    return;
  }

  if (command === "execution" && subcommand === "finish") {
    const status = values.status || "completed";
    const changes = { status, finished_at: new Date().toISOString(), updated_at: new Date().toISOString() };
    const result = await writeCloudOrQueue(state, config, "workspace_executions", "PATCH", changes, `?id=eq.${values.id}`);
    const existingExecution = state.executions.find((execution) => execution.id === values.id);
    const taskId = existingExecution?.taskId || existingExecution?.task_id || null;
    const linkedTask = await updateLinkedTask(state, config, taskId, status === "completed" ? "completed" : status === "blocked" ? "blocked" : "todo");
    state.executions = state.executions.map((execution) => execution.id === values.id ? { ...execution, ...changes, finishedAt: changes.finished_at } : execution);
    saveJson(statePath, state);
    output({ ok: true, executionId: values.id, linkedTask, source: result.queued ? "local_queue" : "cloud", queuedForCloudSync: result.queued || linkedTask.queued, pending: state.events.length, statePath });
    return;
  }

  output({ usage: "serve | connect | register | current | disconnect | sync | watch | evidence list | evidence create | evidence scan | task list | task create | task update | execution start --task TASK_ID | step create | step update | execution finish", statePath });
}

main().catch((error) => { process.stderr.write(`${error instanceof Error ? error.message : String(error)}
`); process.exitCode = 1; });






