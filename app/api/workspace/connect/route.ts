import { execFile } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { NextResponse } from "next/server";

const execFileAsync = promisify(execFile);

function findProjectRoot() {
  const candidates = [
    process.env.LEARNING_OS_ROOT,
    process.env.INIT_CWD,
    process.cwd(),
  ];
  try { candidates.push(path.dirname(fileURLToPath(import.meta.url))); } catch {}
  const visited = new Set<string>();
  for (const initial of candidates.filter(Boolean)) {
    let candidate = path.resolve(initial as string);
    for (let depth = 0; depth < 10; depth += 1) {
      if (visited.has(candidate)) break;
      visited.add(candidate);
      if (fs.existsSync(path.join(candidate, "scripts", "learning-os-workspace.mjs"))) return candidate;
      const parent = path.dirname(candidate);
      if (parent === candidate) break;
      candidate = parent;
    }
  }
  return null;
}
function resolveConnectorDirectory(value: unknown) {
  const requested = typeof value === "string" ? value.trim().replace(/^['"]|['"]$/g, "") : "";
  const candidate = requested ? path.resolve(requested) : path.resolve(process.cwd());
  try {
    if (fs.statSync(candidate).isDirectory()) return { cwd: candidate, usedFallback: false };
  } catch {}
  try {
    if (fs.statSync(process.cwd()).isDirectory()) return { cwd: path.resolve(process.cwd()), usedFallback: Boolean(requested) };
  } catch {}
  return null;
}

export async function POST(request: Request) {
  let body: { code?: unknown; cwd?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求体必须是有效 JSON。" }, { status: 400 });
  }

  const code = typeof body.code === "string" ? body.code.trim() : "";
  const resolved = resolveConnectorDirectory(body.cwd);
  const projectRoot = findProjectRoot();
  if (!code) return NextResponse.json({ error: "缺少配对码。" }, { status: 400 });
  if (!resolved) return NextResponse.json({ error: "当前应用目录不存在，无法启动本地连接器。" }, { status: 400 });
  if (!projectRoot) return NextResponse.json({ error: `未找到本地连接器脚本。请重启开发服务；运行目录：${process.cwd()}，LEARNING_OS_ROOT：${process.env.LEARNING_OS_ROOT || "未设置"}` }, { status: 500 });

  const script = path.join(projectRoot, "scripts", "learning-os-workspace.mjs");
  try {
    const { stdout } = await execFileAsync(process.execPath, [script, "connect", "--code", code, "--cwd", resolved.cwd], { cwd: projectRoot, windowsHide: true, timeout: 30_000 });
    return NextResponse.json({ ok: true, cwd: resolved.cwd, usedFallback: resolved.usedFallback, result: stdout.trim() });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: `本地连接器连接失败：${message}` }, { status: 502 });
  }
}


