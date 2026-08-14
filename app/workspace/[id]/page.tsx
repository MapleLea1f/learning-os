"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import Link from "next/link";
import { FormEvent, useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import type { Session } from "@supabase/supabase-js";
import { getSupabase, isSupabaseConfigured } from "../../supabase-client";
import type { Workspace, WorkspaceResource, WorkspaceResourceType, WorkspaceTask, WorkspaceTaskPriority, WorkspaceTaskStatus } from "../../workspace-types";

type WorkPlan = { id: string; title: string; status: string; workspace_id: string | null };
type WorkspaceEvidence = { id: string; evidence_type: string; title: string; content: string; metadata: { commit?: string; files?: string[] }; observed_at: string };

const priorityLabels: Record<WorkspaceTaskPriority, string> = { high: "高", medium: "中", low: "低" };
const statusLabels: Record<WorkspaceTaskStatus, string> = { todo: "待处理", in_progress: "进行中", completed: "已完成", blocked: "已阻塞" };
const resourceLabels: Record<WorkspaceResourceType, string> = { link: "网页链接", chatgpt: "历史 ChatGPT 链接（旧）", deepseek: "网页链接（旧）", local_path: "本地目录", file_output: "产出文件（旧）" };
const resourceOptions = [["link", "网页链接"], ["local_path", "本地目录"]] as const;



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
  const [loading, setLoading] = useState(true);
  const [message, setMessage] = useState("");
  const [taskTitle, setTaskTitle] = useState("");
  const [taskPriority, setTaskPriority] = useState<WorkspaceTaskPriority>("medium");
  const [taskDueDate, setTaskDueDate] = useState("");
  const [editingTaskId, setEditingTaskId] = useState<string | null>(null);
  const [editingTaskTitle, setEditingTaskTitle] = useState("");
  const [resourceType, setResourceType] = useState<WorkspaceResourceType>("link");
  const [resourceTitle, setResourceTitle] = useState("");
  const [resourceValue, setResourceValue] = useState("");
  const [resourceNote, setResourceNote] = useState("");

  const activeTasks = useMemo(() => tasks.filter((task) => task.status !== "completed"), [tasks]);
  const completedTasks = useMemo(() => tasks.filter((task) => task.status === "completed"), [tasks]);

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
      const [{ data: workspaceData, error: workspaceError }, { data: taskData }, { data: resourceData }, { data: evidenceData }, { data: planData }] = await Promise.all([
        client.from("workspaces").select("*").eq("id", workspaceId).single(),
        client.from("workspace_tasks").select("*").eq("workspace_id", workspaceId).order("status", { ascending: true }).order("priority", { ascending: true }).order("updated_at", { ascending: false }),
        client.from("workspace_resources").select("*").eq("workspace_id", workspaceId).order("created_at", { ascending: false }),
        client.from("workspace_evidence").select("id,evidence_type,title,content,metadata,observed_at").eq("workspace_id", workspaceId).order("observed_at", { ascending: false }).limit(12),
        client.from("work_plans").select("id,title,status,workspace_id").eq("workspace_id", workspaceId).order("updated_at", { ascending: false }),
      ]);
      if (cancelled) return;
      setAuthorized(true);
      if (workspaceError || !workspaceData) setMessage(`读取工作区失败：${workspaceError?.message ?? "工作区不存在"}`);
      setWorkspace((workspaceData as Workspace | null) ?? null);
      setTasks((taskData as WorkspaceTask[] | null) ?? []);
      setResources((resourceData as WorkspaceResource[] | null) ?? []);
      setEvidence((evidenceData as WorkspaceEvidence[] | null) ?? []);
      setPlans((planData as WorkPlan[] | null) ?? []);
      setLoading(false);
    }
    void load();
    return () => { cancelled = true; };
  }, [session, workspaceId]);

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

  if (!isSupabaseConfigured) return <main className="workspace-shell"><section className="workspace-card workspace-empty"><h1>工作区</h1><p>请先配置 Supabase，再使用工作区。</p><Link className="button" href="/">返回日报</Link></section></main>;
  if (!session) return <main className="workspace-shell"><section className="workspace-card workspace-empty"><h1>工作区</h1><p>请先完成 GitHub 登录。</p><Link className="button" href="/">返回日报</Link></section></main>;
  if (!authorized && !loading) return <main className="workspace-shell"><section className="workspace-card workspace-empty"><h1>等待授权</h1><p>当前账号还没有工作区读写权限，请先配置 allowed_users。</p><Link className="button" href="/">返回日报</Link></section></main>;
  if (loading) return <main className="workspace-shell"><p className="workspace-empty">正在读取工作区…</p></main>;
  if (!workspace) return <main className="workspace-shell"><section className="workspace-card workspace-empty"><h1>工作区不存在</h1><Link className="button" href="/workspaces">返回工作区列表</Link></section></main>;

  return <main className="workspace-shell">
    <header className="workspace-header"><div><div className="eyebrow">计划工作台</div><h1>{workspace.name}</h1><p>{workspace.description || "这个工作区还没有说明。"}</p>{workspace.local_path && <div className="workspace-local-path"><code className="workspace-path">{workspace.local_path}</code><button className="button-quiet" type="button" onClick={() => void openLocalPath(workspace.local_path || "").catch((error) => setMessage(error instanceof Error ? error.message : "打开本地路径失败。"))}>打开本地目录</button></div>}</div><div className="workspace-header-actions"><Link className="button button-secondary" href="/workspaces">工作区列表</Link><Link className="button button-secondary" href="/">返回日报</Link></div></header>
    {message && <p className="workspace-feedback" role="status">{message}</p>}
    <section className="workspace-detail-grid">
      <div className="workspace-main-column">
        <section className="workspace-card"><div className="workspace-card-head"><div><span className="eyebrow">执行清单</span><h2>待办事项</h2></div><span>{activeTasks.length} 个未完成</span></div><form className="workspace-task-form" onSubmit={createTask}><input value={taskTitle} placeholder="添加一个需要推进的事项" onChange={(event) => setTaskTitle(event.target.value)} /><select value={taskPriority} onChange={(event) => setTaskPriority(event.target.value as WorkspaceTaskPriority)}>{Object.entries(priorityLabels).map(([value, label]) => <option key={value} value={value}>{label}优先级</option>)}</select><input type="date" value={taskDueDate} onChange={(event) => setTaskDueDate(event.target.value)} /><button className="button" type="submit" disabled={!taskTitle.trim()}>添加待办</button></form><div className="workspace-task-list">{activeTasks.map((task) => <article className={`workspace-task-row priority-${task.priority}`} key={task.id}>{editingTaskId === task.id ? <div className="workspace-task-edit"><input autoFocus value={editingTaskTitle} onChange={(event) => setEditingTaskTitle(event.target.value)} /><button className="button button-secondary" type="button" onClick={() => { void updateTask(task, { title: editingTaskTitle.trim() || task.title }); setEditingTaskId(null); }}>保存</button><button className="button-quiet" type="button" onClick={() => setEditingTaskId(null)}>取消</button></div> : <><input className="workspace-task-check" type="checkbox" checked={task.status === "completed"} onChange={() => void updateTask(task, { status: task.status === "completed" ? "todo" : "completed" })} /><div className="workspace-task-copy"><strong>{task.title}</strong><span>{priorityLabels[task.priority]}优先级 · {statusLabels[task.status]}{task.due_date ? ` · 截止 ${task.due_date}` : ""}</span>{task.notes && <small>{task.notes}</small>}</div><select value={task.status} onChange={(event) => void updateTask(task, { status: event.target.value as WorkspaceTaskStatus })}>{Object.entries(statusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><button className="button-quiet" type="button" onClick={() => { setEditingTaskId(task.id); setEditingTaskTitle(task.title); }}>编辑</button><button className="button-quiet danger" type="button" onClick={() => void deleteTask(task)}>删除</button></>}</article>)}{!activeTasks.length && <p className="workspace-empty">还没有未完成待办，可以从一个最小动作开始。</p>}</div>{completedTasks.length > 0 && <details className="workspace-completed"><summary>已完成 {completedTasks.length} 项</summary>{completedTasks.map((task) => <div className="workspace-completed-row" key={task.id}><span>✓</span><strong>{task.title}</strong><button className="button-quiet" type="button" onClick={() => void updateTask(task, { status: "todo" })}>恢复</button></div>)}</details>}</section>
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
      <aside className="workspace-side-column"><section className="workspace-card"><div className="workspace-card-head"><div><span className="eyebrow">关联计划</span><h2>计划</h2></div><span>{plans.length} 个</span></div>{plans.map((plan) => <Link className="workspace-plan-row" href="/" key={plan.id}><strong>{plan.title}</strong><span>{plan.status}</span></Link>)}{!plans.length && <p className="workspace-empty">还没有关联计划。</p>}</section><section className="workspace-card workspace-note-card"><span className="eyebrow">下一阶段</span><p>Codex 会读取待办，并记录步骤、验证和 Git 证据。</p></section></aside>
    </section>
  </main>;
}




