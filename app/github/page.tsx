"use client";

/* eslint-disable react-hooks/set-state-in-effect */

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { getSupabase, isSupabaseConfigured } from "../supabase-client";

type GitHubRepo = {
  id: number;
  full_name: string;
  html_url: string;
  description: string | null;
  default_branch: string;
  stargazers_count: number;
};

type GitHubCommit = {
  sha: string;
  html_url: string;
  commit: {
    message: string;
    author: { name: string; date: string | null } | null;
  };
  repository: string;
};

type LoadState = "idle" | "loading" | "ready" | "error";

const importKey = "learning-os:github-evidence-import";

function toDateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function dateLabel(dateKey: string) {
  return new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date(`${dateKey}T12:00:00`));
}

function githubHeaders(token: string) {
  return { Accept: "application/vnd.github+json", Authorization: `Bearer ${token}`, "X-GitHub-Api-Version": "2022-11-28" };
}

async function githubFetch<T>(path: string, token: string): Promise<T> {
  const response = await fetch(`https://api.github.com${path}`, { headers: githubHeaders(token) });
  if (!response.ok) {
    const message = response.status === 403 ? "GitHub API 触发限流，请稍后重试。" : response.status === 401 ? "GitHub 登录授权已失效，请重新登录。" : `GitHub API 返回 ${response.status}。`;
    throw new Error(message);
  }
  return response.json() as Promise<T>;
}

export default function GitHubEvidencePage() {
  const [date, setDate] = useState(() => new URLSearchParams(typeof window === "undefined" ? "" : window.location.search).get("date") ?? toDateKey(new Date()));
  const [token, setToken] = useState<string | null>(null);
  const [repos, setRepos] = useState<GitHubRepo[]>([]);
  const [selectedRepos, setSelectedRepos] = useState<string[]>([]);
  const [commits, setCommits] = useState<GitHubCommit[]>([]);
  const [selectedCommits, setSelectedCommits] = useState<string[]>([]);
  const [repoState, setRepoState] = useState<LoadState>("idle");
  const [commitState, setCommitState] = useState<LoadState>("idle");
  const [message, setMessage] = useState("");

  useEffect(() => {
    const client = getSupabase();
    if (!client) return;
    client.auth.getSession().then(({ data }) => setToken(data.session?.provider_token ?? null));
  }, []);

  useEffect(() => {
    if (!token) return;
    setRepoState("loading");
    githubFetch<GitHubRepo[]>("/user/repos?visibility=public&affiliation=owner&sort=pushed&direction=desc&per_page=100", token)
      .then((items) => {
        setRepos(items);
        setSelectedRepos((current) => current.length ? current : items.slice(0, 5).map((repo) => repo.full_name));
        setRepoState("ready");
      })
      .catch((error: Error) => { setRepoState("error"); setMessage(error.message); });
  }, [token]);

  useEffect(() => {
    if (!token || !selectedRepos.length) return;
    const controller = new AbortController();
    const [year, month, day] = date.split("-").map(Number);
    const since = new Date(Date.UTC(year, month - 1, day)).toISOString();
    const until = new Date(Date.UTC(year, month - 1, day + 1)).toISOString();
    setCommitState("loading");
    setMessage("");
    Promise.all(selectedRepos.map(async (repo) => {
      const response = await fetch(`https://api.github.com/repos/${repo}/commits?since=${encodeURIComponent(since)}&until=${encodeURIComponent(until)}&per_page=100`, { headers: githubHeaders(token), signal: controller.signal });
      if (!response.ok) throw new Error(response.status === 403 ? "GitHub API 触发限流，请稍后重试。" : `读取 ${repo} 提交失败（${response.status}）。`);
      const data = await response.json() as Array<Omit<GitHubCommit, "repository">>;
      return data.map((commit) => ({ ...commit, repository: repo }));
    }))
      .then((items) => { setCommits(items.flat().sort((left, right) => (right.commit.author?.date ?? "").localeCompare(left.commit.author?.date ?? ""))); setSelectedCommits([]); setCommitState("ready"); })
      .catch((error: Error) => { if (error.name !== "AbortError") { setCommitState("error"); setMessage(error.message); } });
    return () => controller.abort();
  }, [date, selectedRepos, token]);

  const selectedCount = selectedCommits.length;
  const selectedCommitItems = useMemo(() => commits.filter((commit) => selectedCommits.includes(commit.sha)), [commits, selectedCommits]);

  function toggleRepo(repo: string) {
    setSelectedRepos((current) => current.includes(repo) ? current.filter((item) => item !== repo) : [...current, repo]);
  }

  function toggleCommit(sha: string) {
    setSelectedCommits((current) => current.includes(sha) ? current.filter((item) => item !== sha) : [...current, sha]);
  }

  function importCommits() {
    if (!selectedCommitItems.length) return;
    const items = selectedCommitItems.map((commit) => ({ id: `github-${commit.sha}`, type: "github_commit", repo: commit.repository, message: commit.commit.message, commitUrl: commit.html_url, title: commit.commit.message.split("\n")[0], createdAt: commit.commit.author?.date ?? new Date().toISOString() }));
    localStorage.setItem(importKey, JSON.stringify({ date, items }));
    window.location.href = `/?date=${date}`;
  }

  if (!isSupabaseConfigured) return <main className="github-shell"><section className="github-card"><h1>GitHub 证据页</h1><p>请先配置 Supabase，再使用 GitHub 登录读取公开仓库。</p><Link className="button" href="/">返回日报</Link></section></main>;

  return <main className="github-shell">
    <header className="github-header"><div><div className="eyebrow">Phase 1 · 工程证据</div><h1>GitHub 提交展示</h1><p>选择日期和公开仓库，查看当天提交，并一键带回日报证据。</p></div><Link className="button button-secondary" href={`/?date=${date}`}>返回日报</Link></header>
    {!token ? <section className="github-card github-empty"><h2>需要 GitHub 登录</h2><p>请先回到日报完成 GitHub 登录。登录授权只用于读取你拥有的公开仓库。</p><Link className="button" href="/">返回日报登录</Link></section> : <>
      <section className="github-toolbar"><label><span>记录日期</span><input type="date" value={date} onChange={(event) => setDate(event.target.value)} /></label><span className="github-count">{commitState === "loading" ? "正在读取提交…" : `找到 ${commits.length} 条提交`}</span></section>
      <section className="github-layout">
        <aside className="github-card repo-card"><div className="github-card-head"><div><span className="eyebrow">公开仓库</span><h2>选择跟踪范围</h2></div><span>{selectedRepos.length} 个已选</span></div>{repoState === "loading" && <p className="empty-state">正在读取公开仓库…</p>}{repoState === "error" && <p className="github-error">{message}</p>}{repos.map((repo) => <label className="repo-option" key={repo.id}><input type="checkbox" checked={selectedRepos.includes(repo.full_name)} onChange={() => toggleRepo(repo.full_name)} /><span><strong>{repo.full_name}</strong><small>{repo.description || "暂无描述"}</small></span></label>)}</aside>
        <section className="github-card commit-card"><div className="github-card-head"><div><span className="eyebrow">{dateLabel(date)}</span><h2>提交记录</h2></div><span>{selectedCount} 条待导入</span></div>{commitState === "loading" && <p className="empty-state">正在读取提交记录…</p>}{commitState === "error" && <p className="github-error">{message}</p>}{commitState === "ready" && !commits.length && <p className="empty-state">当天没有找到提交。可以换日期或选择其他仓库。</p>}<div className="commit-list">{commits.map((commit) => <label className={`commit-option ${selectedCommits.includes(commit.sha) ? "selected" : ""}`} key={commit.sha}><input type="checkbox" checked={selectedCommits.includes(commit.sha)} onChange={() => toggleCommit(commit.sha)} /><span className="commit-mark">↗</span><span className="commit-copy"><strong>{commit.commit.message.split("\n")[0]}</strong><small>{commit.repository} · {commit.sha.slice(0, 7)} · {commit.commit.author?.date ? new Date(commit.commit.author.date).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" }) : ""}</small></span><a href={commit.html_url} target="_blank" rel="noreferrer" aria-label={`打开提交：${commit.commit.message}`}>查看</a></label>)}</div></section>
      </section>
      <section className="github-import-bar"><span>已选 {selectedCount} 条提交，导入后会出现在 {dateLabel(date)} 的证据区。</span><button className="button" type="button" disabled={!selectedCount} onClick={importCommits}>导入当天日报证据</button></section>
    </>}
    {message && token && <p className="github-feedback" role="status">{message}</p>}
  </main>;
}