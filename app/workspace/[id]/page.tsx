"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { getSupabase, isSupabaseConfigured } from "../../supabase-client";
import type { Workspace, WorkspaceExecution, WorkspaceExecutionStatus, WorkspaceExecutionStep, WorkspaceExecutionStepStatus, WorkspaceResource, WorkspaceResourceType, WorkspaceTask, WorkspaceTaskPriority, WorkspaceTaskStatus } from "../../workspace-types";

type WorkPlan = { id: string; title: string; status: string; workspace_id: string | null; details: string };
type WorkspaceEvidence = { id: string; evidence_type: string; title: string; content: string; metadata: { commit?: string; files?: string[] }; observed_at: string };

const priorityLabels: Record<WorkspaceTaskPriority, string> = { high: "高", medium: "中", low: "低" };
const statusLabels: Record<WorkspaceTaskStatus, string> = { todo: "待处理", in_progress: "进行中", completed: "已完成", blocked: "已阻塞" };
const executionStatusLabels: Record<WorkspaceExecutionStatus, string> = { in_progress: "进行中", completed: "已完成", blocked: "已阻塞", cancelled: "已取消" };
const stepStatusLabels: Record<WorkspaceExecutionStepStatus, string> = { pending: "待处理", in_progress: "进行中", completed: "已完成", blocked: "已阻塞", cancelled: "已取消" };
const resourceLabels: Record<WorkspaceResourceType, string> = { link: "网页链接", chatgpt: "历史 ChatGPT 链接（旧）", deepseek: "网页链接（旧）", local_path: "本地目录", file_output: "产出文件（旧）" };
const resourceOptions = [["link", "网页链接"], ["local_path", "本地目录"]] as const;
const workspaceTimerContextStorageKey = "learning-os:workspace-timer-context";
type PairingResult = { ok?: boolean; cwd?: string; usedFallback?: boolean; error?: string };



async function openLocalPath(pathValue: string) {
  const response = await fetch("http://127.0.0.1:4317/open", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: pathValue }),
  });
  const payload = await response.json() as { error?: string };
  if (!response.ok) throw new Error(payload.error || "打开本地路径失败。");
}

async function pickLocalPath(kind: "file" | "directory") {
  const response = await fetch("http://127.0.0.1:4317/pick", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ kind }),
  });
  const payload = await response.json() as { path?: string | null; error?: string };
  if (!response.ok) throw new Error(payload.error || "选择本地路径失败。");
  return payload.path || "";
}
function formatDuration(startedAt: string, finishedAt: string | null) {
  const end = finishedAt ? new Date(finishedAt).getTime() : Date.now();
  const minutes = Math.max(0, Math.round((end - new Date(startedAt).getTime()) / 60000));
  if (minutes < 1) return "不足 1 分钟";
  if (minutes < 60) return `${minutes} 分钟`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} 小时 ${rest} 分钟` : `${hours} 小时`;
}
export default function WorkspaceDetailPage() {
  const params = useParams<{ id: string }>();
  const workspaceId = params.id;
  const [session, setSession] = useState<Session | null>(null);
  const [authorized, setAuthorized] = useState(false);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [tasks, setTasks] = useState<WorkspaceTask[]>([]);
  const [resources, setResources] = useState<WorkspaceResource[]>([]);
  const [evidence, setEvidence] = useState<WorkspaceEvidence[]>([]);
  const [plans, setPlans] = useState<WorkPlan[]>([]);
  const [executions, setExecutions] = useState<WorkspaceExecution[]>([]);
  const [steps, setSteps] = useState<WorkspaceExecutionStep[]>([]);
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [pairingLoading, setPairingLoading] = useState(false);
  const [pairingConnected, setPairingConnected] = useState(false);
  const [pairingCode, setPairingCode] = useState("");
  const [pairingId, setPairingId] = useState<string | null>(null);
  const [taskTitle, setTaskTitle] = useState("");
  const [taskPriority, setTaskPriority] = useState<WorkspaceTaskPriority>("medium");
  const [taskDueDate, setTaskDueDate] = useState("");
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTaskTitle, setEditingTaskTitle] = useState("");
  const [resourceType, setResourceType] = useState<WorkspaceResourceType>("link");
  const [resourceTitle, setResourceTitle] = useState("");
  const [resourceValue, setResourceValue] = useState("");
  const [resourceNote, setResourceNote] = useState("");
  const [editingWorkspace, setEditingWorkspace] = useState(false);
  const [workspaceName, setWorkspaceName] = useState("");
  const [workspaceDescription, setWorkspaceDescription] = useState("");
  const [workspaceLocalPath, setWorkspaceLocalPath] = useState("");

  const activeTasks = useMemo(() => tasks.filter((task) => task.status !== "completed"), [tasks]);
  const completedTasks = useMemo(() => tasks.filter((task) => task.status === "completed"), [tasks]);
  const stepsByExecution = useMemo(() => {
    const grouped = new Map<string, WorkspaceExecutionStep[]>();
    for (const step of steps) {
      const list = grouped.get(step.execution_id) ?? [];
      list.push(step);
      grouped.set(step.execution_id, list);
    }
    return grouped;
  }, [steps]);

  useEffect(() => {
    const client = getSupabase();
    if (!client) { setLoading(false); return; }
    client.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = client.auth.onAuthStateChange((_event, nextSession) => setSession(nextSession));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session || !workspaceId) { setLoading(false); return; }
    const client = getSupabase();
    if (!client) return;
    let cancelled = false;
    async function load() {
      setLoading(true);
      const { data: access } = await client.from("allowed_users").select("user_id").eq("user_id", session?.user.id).maybeSingle();
      if (!access) { setAuthorized(false); setLoading(false); return; }
      const [{ data: workspaceData, error: workspaceError }, { data: taskData }, { data: resourceData }, { data: evidenceData }, { data: planData }, { data: executionData }, { data: stepData }] = await Promise.all([
        client.from("workspaces").select("*").eq("id", workspaceId).single(),
        client.from("workspace_tasks").select("*").eq("workspace_id", workspaceId).order("status", { ascending: true }).order("priority", { ascending: true }).order("updated_at", { ascending: false }),
        client.from("workspace_resources").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
        client.from("workspace_evidence").select("id,evidence_type,title,content,metadata,observed_at").eq("workspace_id", workspaceId).order("observed_at", { ascending: false }).limit(12),
        client.from("work_plans").select("id,title,status,workspace_id,details").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }),
        client.from("workspace_executions").select("*").eq("workspace_id", workspaceId).order("started_at", { ascending: false }).limit(10),
        client.from("workspace_execution_steps").select("*").eq("workspace_id", workspaceId).order("position", { ascending: true }).limit(100),
      ]);
      if (cancelled) return;
      setAuthorized(true);
      if (workspaceError || !workspaceData) setMessage(`读取工作区失败：${workspaceError?.message ?? "工作区不存在"}`);
      setWorkspace((workspaceData as Workspace | null) ?? null);
      setTasks((taskData as WorkspaceTask[] | null) ?? []);
      setResources((resourceData as WorkspaceResource[] | null) ?? []);
      setEvidence((evidenceData as WorkspaceEvidence[] | null) ?? []);
      setPlans((planData as WorkPlan[] | null) ?? []);
      setExecutions((executionData as WorkspaceExecution[] | null) ?? []);
      setSteps((stepData as WorkspaceExecutionStep[] | null) ?? []);
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [session, workspaceId]);

  useEffect(() => {
    const requestedPlanId = new URLSearchParams(window.location.search).get("plan");
    const activePlan = plans.find((plan) => plan.id === requestedPlanId && plan.status !== "completed") ?? plans.find((plan) => plan.status !== "completed");
    if (!workspaceId || !activePlan) {
      window.localStorage.removeItem(workspaceTimerContextStorageKey);
      return;
    }
    try {
      window.localStorage.setItem(workspaceTimerContextStorageKey, JSON.stringify({ workspaceId, planId: activePlan.id, workspaceName: workspace?.name ?? "", savedAt: Date.now() }));
    } catch {
      // Timer association remains available through manual selection if browser storage is unavailable.
    }
  }, [plans, workspace?.name, workspaceId]);

  function openWorkspaceEditor() {
    if (!workspace) return;
    setWorkspaceName(workspace.name);
    setWorkspaceDescription(workspace.description);
    setWorkspaceLocalPath(workspace.local_path ?? "");
    setEditingWorkspace(true);
  }

  async function saveWorkspace() {
    if (!workspace || !session) return;
    const name = workspaceName.trim();
    if (!name) {
      setMessage("工作区名称不能为空。");
      return;
    }
    const client = getSupabase();
    if (!client) return;
    const { data, error } = await client.from("workspaces").update({
      name,
      description: workspaceDescription.trim(),
      local_path: workspaceLocalPath.trim() || null,
      updated_at: new Date().toISOString(),
    }).eq("id", workspace.id).select("*").single();
    if (error || !data) setMessage(`保存工作区失败：${error?.message ?? "未返回工作区"}`);
    else {
      setWorkspace(data as Workspace);
      setEditingWorkspace(false);
      setMessage("工作区信息已更新。");
    }
  }

  async function createTask(event: FormEvent) {
    event.preventDefault();
    if (!taskTitle.trim() || !session) return;
    const client = getSupabase();
    if (!client) return;
    const { data, error } = await client.from("workspace_tasks").insert({ workspace_id: workspaceId, user_id: session.user.id, title: taskTitle.trim(), priority: taskPriority, due_date: taskDueDate || null }).select("*").single();
    if (error || !data) setMessage(`创建待办失败：${error?.message ?? "未返回待办"}`);
    else { setTasks((current) => [data as WorkspaceTask, ...current]); setTaskTitle(""); setTaskDueDate(""); setMessage("待办已创建。"); }
  }

  async function updateTask(task: WorkspaceTask, changes: Partial<WorkspaceTask>) {
    const client = getSupabase();
    if (!client) return;
    const { data, error } = await client.from("workspace_tasks").update({ ...changes, updated_at: new Date().toISOString() }).eq("id", task.id).select("*").single();
    if (error || !data) setMessage(`更新待办失败：${error?.message ?? "未返回待办"}`);
    else setTasks((current) => current.map((item) => item.id === task.id ? data as WorkspaceTask : item));
  }

  async function deleteTask(task: WorkspaceTask) {
    const client = getSupabase();
    if (!client || !window.confirm(`确认删除待办“${task.title}”吗？`)) return;
    const { error } = await client.from("workspace_tasks").delete().eq("id", task.id);
    if (error) setMessage(`删除待办失败：${error.message}`);
    else setTasks((current) => current.filter((item) => item.id !== task.id));
  }

  async function createResource(event: FormEvent) {
    event.preventDefault();
    if (!resourceTitle.trim() || !resourceValue.trim() || !session) return;
    const client = getSupabase();
    if (!client) return;
    const isPath = resourceType === "local_path" || resourceType === "file_output";
    const payload = { workspace_id: workspaceId, user_id: session.user.id, resource_type: resourceType, title: resourceTitle.trim(), url: isPath ? null : resourceValue.trim(), path: isPath ? resourceValue.trim() : null, note: resourceNote.trim() };
    const { data, error } = await client.from("workspace_resources").insert(payload).select("*").single();
    if (error || !data) setMessage(`添加资源失败：${error?.message ?? "未返回资源"}`);
    else { setResources((current) => [data as WorkspaceResource, ...current]); setResourceTitle(""); setResourceValue(""); setResourceNote(""); setMessage("资源已添加。"); }
  }

  async function deleteResource(resource: WorkspaceResource) {
    const client = getSupabase();
    if (!client) return;
    const { error } = await client.from("workspace_resources").delete().eq("id", resource.id);
    if (error) setMessage(`删除资源失败：${error.message}`);
    else setResources((current) => current.filter((item) => item.id !== resource.id));
  }
  async function createPairing() {
    const client = getSupabase();
    if (!client || !workspace) return;
    setPairingLoading(true);
    setMessage("正在连接本地连接器…");
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
    const pairingPayload = {
      user_id: currentSession.user.id,
      workspace_id: workspace.id,
      pairing_code_hash: codeHash,
      access_token: currentSession.access_token,
      refresh_token: currentSession.refresh_token ?? null,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(),
    };
    let { data, error } = await client.from("connector_pairings").insert(pairingPayload).select("id").single();
    if (error?.code === "PGRST204" || (error?.message || "").includes("refresh_token")) {
      const { data: retryData, error: retryError } = await client.from("connector_pairings").insert({ ...pairingPayload, refresh_token: undefined }).select("id").single();
      data = retryData;
      error = retryError;
      if (!error) setMessage("已连接，但数据库缺少 refresh_token 字段，建议在 Supabase SQL Editor 运行 supabase/schema.sql 以支持自动续期。");
    }
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
    setPairingConnected(false);
    const connectResponse = await fetch("http://127.0.0.1:4317/connect", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ code: formattedCode, cwd: workspace.local_path || null }),
    }).catch(() => null);
    const payload = connectResponse ? await connectResponse.json().catch(() => ({})) as PairingResult : { error: "本机连接器未启动，请先运行 node scripts/learning-os-workspace.mjs serve。" };
    if (!connectResponse?.ok) {
      setPairingConnected(false);
      setMessage(`自动连接失败：${payload.error || "请使用下方命令手动连接。"}`);
    } else if (payload.usedFallback) {
      setPairingConnected(true);
      setMessage("");
    } else {
      setPairingConnected(true);
      setMessage("");
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
        body: JSON.stringify({ cwd: workspace?.local_path || null }),
      }),
    ]);
    const disconnectPayload = disconnectResponse ? await disconnectResponse.json().catch(() => ({})) as PairingResult : { error: "本机连接器未启动，请先运行 node scripts/learning-os-workspace.mjs serve。" };
    if (pairingError || !disconnectResponse?.ok) {
      setMessage(`取消连接失败：${pairingError?.message || disconnectPayload.error || "未知错误"}`);
    } else {
      setPairingConnected(false);
      setPairingId(null);
      setPairingCode("");
      setMessage("");
    }
    setPairingLoading(false);
  }

  if (!isSupabaseConfigured) return <main className="workspace-shell"><section className="workspace-card workspace-empty"><h1>工作区</h1><p>请先配置 Supabase，再使用工作区。</p><Link className="button" href="/">返回日报</Link></section></main>;
  if (!session) return <main className="workspace-shell"><section className="workspace-card workspace-empty"><h1>工作区</h1><p>请先完成 GitHub 登录。</p><Link className="button" href="/">返回日报</Link></section></main>;
  if (!authorized && !loading) return <main className="workspace-shell"><section className="workspace-card workspace-empty"><h1>等待授权</h1><p>当前账号还没有工作区读写权限，请先配置 allowed_users。</p><Link className="button" href="/">返回日报</Link></section></main>;
  if (loading) return <main className="workspace-shell"><p className="workspace-empty">正在读取工作区…</p></main>;
  if (!workspace) return <main className="workspace-shell"><section className="workspace-card workspace-empty"><h1>工作区不存在</h1><Link className="button" href="/workspaces">返回工作区列表</Link></section></main>;

  return <main className="workspace-shell">
    <header className="workspace-header"><div><div className="eyebrow">计划工作台</div><h1>{workspace.name}</h1><p>{workspace.description || "这个工作区还没有说明。"}</p>{workspace.local_path && <div className="workspace-local-path"><code className="workspace-path">{workspace.local_path}</code><button className="button-quiet" type="button" onClick={() => void openLocalPath(workspace.local_path || "").catch((error) => setMessage(error instanceof Error ? error.message : "打开本地路径失败。"))}>打开本地目录</button></div>}</div><div className="workspace-header-actions"><Link className="button button-secondary" href="/workspaces">工作区列表</Link><Link className="button button-secondary" href="/">返回日报</Link><button className="button button-secondary" type="button" onClick={openWorkspaceEditor}>编辑</button><button className="button" type="button" disabled={pairingLoading} onClick={() => void (pairingConnected ? cancelPairing() : createPairing())}>{pairingLoading ? "正在连接…" : pairingConnected ? "取消连接" : "连接本地连接器"}</button></div></header>
    {message && <p className="workspace-feedback" role="status">{message}</p>}
    {pairingCode && <section className={`workspace-card workspace-pairing${pairingConnected ? " connected" : " waiting"}`}><div className="workspace-card-head"><div><span className="eyebrow">本地连接器</span><h2>{pairingConnected ? "已连接" : "等待连接"}：{workspace.name}</h2></div><button className="button-quiet" type="button" disabled={pairingLoading} onClick={() => void cancelPairing()}>{pairingConnected ? "断开连接" : "取消连接"}</button></div>{pairingLoading && !pairingConnected ? <p className="workspace-pairing-status">正在连接本地连接器…</p> : pairingConnected ? <p className="workspace-pairing-status">已自动完成连接，运行 <code>evidence scan</code> 可同步 Git 提交证据。</p> : <div className="workspace-pairing-fallback"><p>自动连接失败，可运行下方命令手动连接（配对码 10 分钟内有效）：</p><code className="workspace-command">node scripts/learning-os-workspace.mjs connect --code {pairingCode} --cwd {workspace.local_path || "."}</code><p className="workspace-pairing-code">配对码 <strong>{pairingCode}</strong>，取消连接后立即失效。</p></div>}</section>}
    {editingWorkspace && workspace && <form className="workspace-card workspace-form" onSubmit={(event) => { event.preventDefault(); void saveWorkspace(); }}><div className="workspace-card-head"><div><span className="eyebrow">工作区设置</span><h2>编辑工作区</h2></div><button className="button-quiet" type="button" onClick={() => setEditingWorkspace(false)}>取消</button></div><div className="workspace-form-grid"><label><span>名称</span><input autoFocus value={workspaceName} placeholder="工作区名称" onChange={(event) => setWorkspaceName(event.target.value)} /></label><label><span>本地目录（可选）</span><div className="workspace-resource-picker"><input readOnly value={workspaceLocalPath} placeholder="点击选择工作区文件夹" /><button className="button button-secondary" type="button" onClick={() => void pickLocalPath("directory").then(setWorkspaceLocalPath).catch((error) => setMessage(error instanceof Error ? error.message : "选择工作区目录失败。"))}>选择文件夹</button></div></label><label className="workspace-wide-field"><span>说明（可选）</span><textarea value={workspaceDescription} placeholder="记录项目或工作内容" onChange={(event) => setWorkspaceDescription(event.target.value)} /></label></div><div className="workspace-form-actions"><button className="button" type="submit">保存修改</button></div></form>}    <section className="workspace-detail-grid">
      <div className="workspace-main-column">
        <section className="workspace-card"><div className="workspace-card-head"><div><span className="eyebrow">执行清单</span><h2>待办事项</h2></div><span>{activeTasks.length} 个未完成</span></div><form className="workspace-task-form" onSubmit={createTask}><input value={taskTitle} placeholder="添加一个需要推进的事项" onChange={(event) => setTaskTitle(event.target.value)} /><select value={taskPriority} onChange={(event) => setTaskPriority(event.target.value as WorkspaceTaskPriority)}>{Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}优先级</option>)}</select><input type="date" value={taskDueDate} onChange={(event) => setTaskDueDate(event.target.value)} /><button className="button" type="submit" disabled={!taskTitle.trim()}>添加待办</button></form><div className="workspace-task-list">{activeTasks.map((task) => <article className={`workspace-task-row priority-${task.priority}`} key={task.id}>{editingTaskId === task.id ? <div className="workspace-task-edit"><input autoFocus value={editingTaskTitle} onChange={(event) => setEditingTaskTitle(event.target.value)} /><button className="button button-secondary" type="button" onClick={() => { void updateTask(task, { title: editingTaskTitle.trim() || task.title }); setEditingTaskId(null); }}>保存</button><button className="button-quiet" type="button" onClick={() => setEditingTaskId(null)}>取消</button></div> : <><input className="workspace-task-check" type="checkbox" checked={task.status === "completed"} onChange={() => void updateTask(task, { status: task.status === "completed" ? "todo" : "completed" })} /><div className="workspace-task-copy"><strong>{task.title}</strong><span>{priorityLabels[task.priority]}优先级 · {statusLabels[task.status]}{task.due_date ? ` · 截止 ${task.due_date}` : ""}</span>{task.notes && <small>{task.notes}</small>}</div><select value={task.status} onChange={(event) => void updateTask(task, { status: event.target.value as WorkspaceTaskStatus })}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button className="button-quiet" type="button" onClick={() => { setEditingTaskId(task.id); setEditingTaskTitle(task.title); }}>编辑</button><button className="button-quiet danger" type="button" onClick={() => void deleteTask(task)}>删除</button></>}</article>)}{!activeTasks.length && <p className="workspace-empty">还没有未完成待办，可以从一个最小动作开始。</p>}</div>{completedTasks.length > 0 && <details className="workspace-completed"><summary>已完成 {completedTasks.length} 项</summary>{completedTasks.map((task) => <div className="workspace-completed-row" key={task.id}><span>✓</span><strong>{task.title}</strong><button className="button-quiet" type="button" onClick={() => void updateTask(task, { status: "todo" })}>恢复</button></div>)}</details>}</section>
        <section className="workspace-card"><div className="workspace-card-head"><div><span className="eyebrow">执行记录</span><h2>步骤与验证</h2></div><span>{executions.length} 条</span></div><div className="workspace-execution-list">{executions.map((execution) => { const executionSteps = stepsByExecution.get(execution.id) ?? []; return <article className="workspace-execution-row" key={execution.id}><div className="workspace-execution-head"><strong>{execution.title}</strong><span className={`execution-status execution-${execution.status}`}>{executionStatusLabels[execution.status]}</span></div><small>{new Date(execution.started_at).toLocaleString("zh-CN")} · {execution.finished_at ? `用时 ${formatDuration(execution.started_at, execution.finished_at)}` : `进行中 ${formatDuration(execution.started_at, null)}`}</small>{executionSteps.length > 0 ? <ol className="workspace-step-list">{executionSteps.map((step) => <li className={`step-${step.status}`} key={step.id}><span>{step.status === "completed" ? "✓" : step.status === "in_progress" ? "●" : step.status === "blocked" ? "!" : "○"}</span><span>{step.title}</span><span className="step-status-label">{stepStatusLabels[step.status]}</span></li>)}</ol> : <small className="workspace-step-empty">暂无步骤</small>}</article>; })}{!executions.length && <p className="workspace-empty">连接本地连接器后，Codex 会话的执行步骤和验证记录会显示在这里。</p>}</div></section>
        <section className="workspace-card">
          <div className="workspace-card-head"><div><span className="eyebrow">关联入口</span><h2>资源</h2></div><span>{resources.length} 项</span></div>
          <form className="workspace-resource-form" onSubmit={createResource}>
            <select value={resourceType} onChange={(event) => setResourceType(event.target.value as WorkspaceResourceType)}>{resourceOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
            <input value={resourceTitle} placeholder="名称" onChange={(event) => setResourceTitle(event.target.value)} />
            {resourceType === "local_path" ? <div className="workspace-resource-picker"><button className="button button-secondary" type="button" onClick={() => void pickLocalPath("directory").then(setResourceValue).catch((error) => setMessage(error instanceof Error ? error.message : "选择文件夹失败。"))}>选择文件夹</button><code>{resourceValue || "尚未选择文件夹"}</code></div> : <input value={resourceValue} placeholder="网页链接（包括 DeepSeek）" onChange={(event) => setResourceValue(event.target.value)} />}
            <button className="button" type="submit" disabled={!resourceTitle.trim() || !resourceValue.trim()}>添加</button>
            <textarea value={resourceNote} placeholder="备注（可选）" onChange={(event) => setResourceNote(event.target.value)} />
          </form>
          <div className="workspace-resource-list">{resources.map((resource) => <article className={`workspace-resource-row workspace-resource-${resource.resource_type}`} key={resource.id}><div><span className="workspace-resource-type">{resource.resource_type === "deepseek" ? "网页链接" : resourceLabels[resource.resource_type]}</span><strong>{resource.title}</strong><small>{resource.note || resource.path || resource.url}</small></div><div className="workspace-resource-actions">{resource.path ? <button className="button-quiet" type="button" onClick={() => void openLocalPath(resource.path || "").catch((error) => setMessage(error instanceof Error ? error.message : "打开本地路径失败。"))}>打开本地位置</button> : resource.url && <a href={resource.url} target="_blank" rel="noreferrer">打开链接</a>}<button className="button-quiet danger" type="button" onClick={() => void deleteResource(resource)}>删除</button></div></article>)}{!resources.length && <p className="workspace-empty">保存计划相关网页和本地目录。DeepSeek 也按普通网页链接保存。</p>}</div>
        </section>
        <section className="workspace-card"><div className="workspace-card-head"><div><span className="eyebrow">Git 提交证据</span><h2>最近的提交证据</h2></div><span>{evidence.length} 条</span></div><div className="workspace-evidence-list">{evidence.map((item) => <article className="workspace-evidence-row" key={item.id}><div><strong>{item.title}</strong><small>{item.content} · {new Date(item.observed_at).toLocaleString("zh-CN")}</small>{item.metadata?.files?.length ? <small>涉及 {item.metadata.files.slice(0, 3).join(", ")}{item.metadata.files.length > 3 ? ` 等 ${item.metadata.files.length} 个文件` : ""}</small> : null}</div>{item.metadata?.commit ? <code>{item.metadata.commit.slice(0, 8)}</code> : null}</article>)}{!evidence.length && <p className="workspace-empty">连接本地连接器后运行 evidence scan，同步 Git 提交。</p>}</div></section>
      </div>
      <aside className="workspace-side-column"><section className="workspace-card"><div className="workspace-card-head"><div><span className="eyebrow">关联计划</span><h2>计划</h2></div><span>{plans.length} 个</span></div>{plans.map((plan) => <Link className="workspace-plan-row" href="/" key={plan.id}><strong>{plan.title}</strong><span>{plan.status}</span><p className="workspace-plan-details">{plan.details || "暂无需求说明"}</p></Link>)}{!plans.length && <p className="workspace-empty">还没有关联计划。</p>}</section><section className="workspace-card workspace-note-card"><span className="eyebrow">联动说明</span><p>当前工作区的活动计划会自动成为计时归属；开始计时后投入会记入该计划。连接本地连接器后，Codex 会话还会在此记录执行步骤、验证命令和 Git 证据。</p></section></aside>
    </section>
  </main>;
}




