import type { Metadata } from "next";
import { LearningDashboard } from "./learning-dashboard";

export const metadata: Metadata = {
  title: "Learning OS｜职业学习看板",
  description: "把每天的具体行动沉淀成可验证的职业证据。",
};

export default function Home() {
  return <LearningDashboard />;
}
