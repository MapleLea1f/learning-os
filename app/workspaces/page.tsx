"use client";

/* eslint-disable react-hooks/set-state-in-effect, react-hooks/purity */

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { getSupabase, isSupabaseConfigured } from "../supabase-client";
import type { Workspace } from "../workspace-types";

type WorkPlan = { id: string; title: string; workspace_id: string | null; status: string };

type PairingResult = { ok?: boolean; cwd?: string; usedFallback?: boolean; error?: string };

async function pickWorkspaceDirectory() {
  const response = await fetch("http://127.0.0.1:4317/pick", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind: "directory" }) });
  const payload = await response.json() as { path?: string | null; error?: string };
  if (!response.ok) throw new Error(payload.error || "选择工作区目录失败。");
  return payload.path || "";
}
export default function WorkspacesPage() {
  const [session, setSession] = useState<{ user: { id: string } } | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [plans, setPlans] = useState<WorkPlan[]>([]);
  const [taskCounts, setTaskCounts] = useState<Record<string, number>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [formOpen, setFormOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [localPath, setLocalPath] = useState("");
  const [planId, setPlanId] = useState("");
  const [pairingCode, setPairingCode] = useState("");
  const [pairingId, setPairingId] = useState<string | null>(null);
  const [pairingWorkspace, setPairingWorkspace] = useState<Workspace | null>(null);
  const [pairingLoading, setPairingLoading] = useState(false);
  const [pairingConnected, setPairingConnected] = useState(false);

  const workspacePlans = useMemo(() => plans.reduce<Record<string, number>>((counts, plan) => {
    if (plan.workspace_id) counts[plan.workspace_id] = (counts[plan.workspace_id] ?? 0) + 1;
    return counts;
  }, {}), [plans]);

  useEffect(() => {
    const client = getSupabase();
    if (!client) { setLoading(false); return; }
    client.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setLoading(false); return; }
    const client = getSupabase();
    if (!client) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      const { data: access } = await client.from("allowed_users").select("user_id").eq("user_id", session.user.id).maybeSingle();
      if (cancelled) return;
      if (!access) { setAuthorized(false); setLoading(false); return; }
      setAuthorized(true);
      const [{ data: workspaceData, error: workspaceError }, { data: planData }, { data: taskData }] = await Promise.all([
        client.from("workspaces").select("*").eq("status", "active").order("updated_at", { ascending: false }),
        client.from("work_plans").select("id,title,workspace_id,status").order("updated_at", { ascending: false }),
        client.from("workspace_tasks").select("workspace_id"),
      ]);
      if (workspaceError) setMessage(`读取工作区失败：${workspaceError.message}`);
      setWorkspaces((workspaceData as Workspace[] | null) ?? []);
      setPlans((planData as WorkPlan[] | null) ?? []);
      setTaskCounts(((taskData as Array<{ workspace_id: string }> | null) ?? []).reduce<Record<string, number>>((counts, task) => {
        counts[task.workspace_id] = (counts[task.workspace_id] ?? 0) + 1;
        return counts;
      }, {}));
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [session]);

  async function createWorkspace(event: FormEvent) {
    event.preventDefault();
    if (!name.trim() || !planId || !session) return;
    const client = getSupabase();
    if (!client) return;
    setSaving(true);
    const { data, error } = await client.from("workspaces").insert({
      user_id: session.user.id,
      name: name.trim(),
      description: description.trim(),
      local_path: localPath.trim() || null,
    }).select("*").single();
    if (error || !data) {
      setMessage(`创建工作区失败：${error?.message ?? "未返回工作区"}`);
    } else {
      const created = data as Workspace;
      const { error: linkError } = await client.from("work_plans").update({ workspace_id: created.id, updated_at: new Date().toISOString() }).eq("id", planId);
      if (linkError) {
        await client.from("workspaces").delete().eq("id", created.id);
        setMessage(`工作区已回滚，计划关联失败：${linkError.message}`);
      } else {
        setWorkspaces((current) => [created, ...current]);
        setPlans((current) => current.map((plan) => plan.id === planId ? { ...plan, workspace_id: created.id } : plan));
        setName(""); setDescription(""); setLocalPath(""); setPlanId(""); setFormOpen(false);
        setMessage("工作区已创建并关联计划。");
      }
    }
    setSaving(false);
  }

  async function createPairing(workspace: Workspace) {
    const client = getSupabase();
    if (!client) return;
    setPairingLoading(true);
    setMessage("正在生成配对码并连接本地连接器…");
    const { data: sessionData } = await client.auth.getSession();
    const currentSession = sessionData.session;
    if (!currentSession) {
      setMessage("请先登录后再连接本地连接器。");
      setPairingLoading(false);
      return;
    }
    const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    const bytes = new Uint8Array(12);
    crypto.getRandomValues(bytes);
    const rawCode = Array.from(bytes, (byte) => alphabet[byte % alphabet.length]).join("");
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(rawCode));
    const codeHash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const { data, error } = await client.from("connector_pairings").insert({
      user_id: currentSession.user.id,
      workspace_id: workspace.id,
      pairing_code_hash: codeHash,
      access_token: currentSession.access_token,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    }).select("id").single();
    if (error || !data) {
      const errorMessage = error?.message || "未知错误";
      const missingTable = error?.code === "PGRST205" || errorMessage.includes("connector_pairings") || errorMessage.includes("schema cache");
      setMessage(missingTable ? "缺少 connector_pairings 表，请在 Supabase SQL Editor 执行 supabase/schema.sql。" : `生成配对码失败：${errorMessage}`);
      setPairingLoading(false);
      return;
    }
    const formattedCode = rawCode.slice(0, 4) + "-" + rawCode.slice(4, 8) + "-" + rawCode.slice(8);
    setPairingCode(formattedCode);
    setPairingId(data.id as string);
    setPairingWorkspace(workspace);
    setPairingConnected(false);
    const connectResponse = await fetch("http://127.0.0.1:4317/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: formattedCode, cwd: workspace.local_path || null }),
    }).catch(() => null);
    const payload = connectResponse ? await connectResponse.json().catch(() => ({})) as PairingResult : { error: "本机连接器未启动，请先运行 node scripts/learning-os-workspace.mjs serve。" };
    if (!connectResponse?.ok) {
      setPairingConnected(false);
      setMessage(`自动连接失败：${payload.error || "请使用下方备用命令连接。"}`);
    } else if (payload.usedFallback) {
      setPairingConnected(true);
      setMessage(`本地连接器已连接，已使用当前项目目录：${payload.cwd}`);
    } else {
      setPairingConnected(true);
      setMessage(`本地连接器已连接：${payload.cwd || "当前项目目录"}。之后可运行 evidence scan 同步 Git 证据。`);
    }
    setPairingLoading(false);
  }

  async function cancelPairing() {
    if (!pairingId) return;
    const client = getSupabase();
    if (!client) return;
    setPairingLoading(true);
    const [{ error: pairingError }, disconnectResponse] = await Promise.all([
      client.from("connector_pairings").update({ used_at: new Date().toISOString() }).eq("id", pairingId),
      fetch("http://127.0.0.1:4317/disconnect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cwd: pairingWorkspace?.local_path || null }),
      }).catch(() => null),
    ]);
    const disconnectPayload = disconnectResponse ? await disconnectResponse.json().catch(() => ({})) as PairingResult : { error: "本机连接器未启动，请先运行 node scripts/learning-os-workspace.mjs serve。" };
    if (pairingError) setMessage(`配对码取消失败：${pairingError.message}`);
    else if (!disconnectResponse?.ok) setMessage(`配对码已失效，但本地解绑失败：${disconnectPayload.error || "请在项目目录手动运行 disconnect。"}`);
    else setMessage("已取消连接，配对码已失效。");
    setPairingWorkspace(null);
    setPairingCode("");
    setPairingId(null);
    setPairingConnected(false);
    setPairingLoading(false);
  }

  if (!isSupabaseConfigured) return <main className="workspace-shell"><section className="workspace-card workspace-empty"><h1>工作区</h1><p>请先配置 Supabase，再使用工作区。</p><Link className="button" href="/">返回日报</Link></section></main>;
  if (!session) return <main className="workspace-shell"><section className="workspace-card workspace-empty"><h1>工作区</h1><p>请先回到日报完成 GitHub 登录。</p><Link className="button" href="/">返回日报</Link></section></main>;
  if (!authorized && !loading) return <main className="workspace-shell"><section className="workspace-card workspace-empty"><h1>等待授权</h1><p>当前账号还没有工作区读写权限，请先完成 Supabase allowed_users 配置。</p><Link className="button" href="/">返回日报</Link></section></main>;

  return <main className="workspace-shell">
    <header className="workspace-header"><div><div className="eyebrow">计划工作台</div><h1>工作区</h1><p>把计划、待办、链接和产出放在一起。</p></div><div className="workspace-header-actions"><Link className="button button-secondary" href="/">返回日报</Link><button className="button" type="button" onClick={() => setFormOpen((open) => !open)}>新建工作区</button></div></header>
    <section className="workspace-card workspace-setup-card"><strong>本地连接器怎么用</strong><p>先运行 <code>node scripts/learning-os-workspace.mjs serve</code> 启动连接器，再点击“连接本地连接器”。运行 <code>evidence scan</code>，同步 Git 提交证据。</p></section>
    {formOpen && <form className="workspace-card workspace-form" onSubmit={createWorkspace}><div className="workspace-card-head"><div><span className="eyebrow">新的上下文</span><h2>创建工作区</h2></div><button className="button-quiet" type="button" onClick={() => setFormOpen(false)}>取消</button></div><div className="workspace-form-grid"><label><span>名称</span><input autoFocus value={name} placeholder="例如：Learning OS 项目" onChange={(event) => setName(event.target.value)} /></label><label><span>关联计划</span><select value={planId} onChange={(event) => setPlanId(event.target.value)}><option value="">选择一个计划</option>{plans.filter((plan) => !plan.workspace_id).map((plan) => <option key={plan.id} value={plan.id}>{plan.title}</option>)}</select></label><label><span>本地目录（可选）</span><div className="workspace-resource-picker"><input readOnly value={localPath} placeholder="点击选择工作区文件夹" /><button className="button button-secondary" type="button" onClick={() => void pickWorkspaceDirectory().then(setLocalPath).catch((error) => setMessage(error instanceof Error ? error.message : "选择工作区目录失败。"))}>选择文件夹</button></div></label><label className="workspace-wide-field"><span>说明（可选）</span><textarea value={description} placeholder="记录项目或工作内容" onChange={(event) => setDescription(event.target.value)} /></label></div><div className="workspace-form-actions"><button className="button" type="submit" disabled={saving || !name.trim() || !planId}>{saving ? "正在创建…" : "创建工作区"}</button></div></form>}
    {message && <p className="workspace-feedback" role="status">{message}</p>}
    {pairingWorkspace && <section className="workspace-card workspace-pairing"><div className="workspace-card-head"><div><span className="eyebrow">本地连接器</span><h2>{pairingConnected ? "已连接" : "等待连接"}：{pairingWorkspace.name}</h2></div><button className="button-quiet" type="button" disabled={pairingLoading} onClick={() => void cancelPairing()}>取消连接</button></div><p>{pairingConnected ? "已自动完成连接。" : "自动连接失败，可使用命令手动连接。"} 配对码 10 分钟后失效。</p><code className="workspace-command">node scripts/learning-os-workspace.mjs connect --code {pairingCode} --cwd .</code><strong className="workspace-pairing-code">{pairingCode}</strong><small>取消后配对码立即失效。</small></section>}
    {loading ? <p className="workspace-empty">正在读取工作区…</p> : <section className="workspace-grid">{workspaces.map((workspace) => <article className="workspace-card workspace-list-card" key={workspace.id}><div className="workspace-card-head"><div><span className="eyebrow">工作区</span><h2>{workspace.name}</h2></div><span className="workspace-status">{workspace.status === "active" ? "使用中" : "已归档"}</span></div><p>{workspace.description || "暂无说明。"}</p>{workspace.local_path && <code className="workspace-path">{workspace.local_path}</code>}<div className="workspace-stats"><span>{workspacePlans[workspace.id] ?? 0} 个关联计划</span><span>{taskCounts[workspace.id] ?? 0} 个待办</span></div><div className="workspace-card-actions"><Link className="button button-secondary" href={`/workspace/${workspace.id}`}>打开工作区</Link><button className="button-quiet" type="button" disabled={pairingLoading} onClick={() => void createPairing(workspace)}>连接本地连接器</button></div></article>)}{!workspaces.length && <div className="workspace-card workspace-empty"><h2>还没有工作区</h2><p>{plans.some((plan) => !plan.workspace_id) ? "可从上方选择一个未关联计划。" : "暂无可关联计划，请先创建计划。"}</p></div>}</section>}
  </main>;
}





