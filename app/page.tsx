import type { Metadata } from "next";
import { LearningDashboard } from "./learning-dashboard";

export const metadata: Metadata = {
  title: "Learning OS · 闲置贩子",
  description: "把学习投入沉淀为可验证的 AI 产品工程证据。",
};

export default function Home() {
  return <LearningDashboard />;
}
