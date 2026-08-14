import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { NextResponse } from "next/server";

function openInExplorer(target: string) {
  const resolved = path.resolve(target);
  const stats = fs.statSync(resolved);
  const args = stats.isDirectory() ? [resolved] : ["/select,", resolved];
  const child = spawn("explorer.exe", args, { detached: true, stdio: "ignore", windowsHide: true });
  child.unref();
  return { path: resolved, kind: stats.isDirectory() ? "directory" : "file" };
}

export async function POST(request: Request) {
  let body: { path?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Request body must be valid JSON." }, { status: 400 });
  }

  if (typeof body.path !== "string" || !body.path.trim()) {
    return NextResponse.json({ error: "A local path is required." }, { status: 400 });
  }

  try {
    return NextResponse.json({ ok: true, opened: openInExplorer(body.path.trim()) });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unable to open the local path.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
