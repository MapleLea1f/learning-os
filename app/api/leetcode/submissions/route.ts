import { NextResponse } from "next/server";

const query = `query recentAcSubmissions($userSlug: String!) {
  recentACSubmissions(userSlug: $userSlug) {
    submissionId
    submitTime
    question {
      title
      translatedTitle
      titleSlug
      questionFrontendId
    }
  }
}`;

type Submission = { id: string; title: string; titleSlug: string; timestamp: string };
type LeetCodeResponse = {
  data?: {
    recentACSubmissions?: Array<{
      submissionId: string;
      submitTime: string;
      question?: {
        title?: string;
        translatedTitle?: string;
        titleSlug?: string;
      } | null;
    }>;
  };
  errors?: Array<{ message?: string }>;
};

export async function GET(request: Request) {
  const url = new URL(request.url);
  const username = (url.searchParams.get("username") ?? "").trim();
  const date = url.searchParams.get("date") ?? "";
  if (!/^[a-zA-Z0-9_-]{2,64}$/.test(username) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json({ error: "Invalid username or date." }, { status: 400 });
  }

  const response = await fetch("https://leetcode.cn/graphql/noj-go/", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json", Referer: "https://leetcode.cn/" },
    body: JSON.stringify({ operationName: "recentAcSubmissions", query, variables: { userSlug: username } }),
    cache: "no-store",
  });
  if (!response.ok) {
    const upstreamBody = await response.text();
    return NextResponse.json({ error: `LeetCode.cn returned ${response.status}.`, details: upstreamBody.slice(0, 300) }, { status: 502 });
  }

  const payload = await response.json() as LeetCodeResponse;
  if (payload.errors?.length) return NextResponse.json({ error: payload.errors[0]?.message ?? "Unable to read LeetCode submissions." }, { status: 502 });
  const [year, month, day] = date.split("-").map(Number);
  const start = Date.UTC(year, month - 1, day) / 1000;
  const end = Date.UTC(year, month - 1, day + 1) / 1000;
  const submissions: Submission[] = (payload.data?.recentACSubmissions ?? [])
    .map((item) => ({
      id: item.submissionId,
      title: item.question?.translatedTitle || item.question?.title || "Unknown problem",
      titleSlug: item.question?.titleSlug ?? "",
      timestamp: item.submitTime,
    }))
    .filter((item) => {
      const timestamp = Number(item.timestamp);
      return Number.isFinite(timestamp) && timestamp >= start && timestamp < end;
    });
  return NextResponse.json({ username, date, submissions });
}
