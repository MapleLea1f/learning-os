import type { Session } from "@supabase/supabase-js";

function isGitHubLogin(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9-]{1,39}$/.test(value);
}

export function getGitHubLogin(session: Session | null) {
  if (!session) return null;
  const metadata = session.user.user_metadata ?? {};
  const identity = session.user.identities?.find((item) => item.provider === "github");
  const identityData = identity?.identity_data ?? {};
  const candidates = [metadata.user_name, metadata.preferred_username, metadata.login, identityData.user_name, identityData.login];
  return candidates.find(isGitHubLogin) ?? null;
}

export function githubHeaders(token?: string) {
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  return headers;
}
