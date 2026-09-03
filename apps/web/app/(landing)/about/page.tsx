import type { Metadata } from "next";
import { AboutPageClient } from "@/features/landing/components/about-page-client";

export const metadata: Metadata = {
  title: "About",
  description:
    "Learn about 鸿翼灵工 — multiplexed information and computing agent. An open-source project management platform for human + agent teams.",
  openGraph: {
    title: "About 鸿翼灵工",
    description:
      "The story behind 鸿翼灵工 and why we're building project management for human + agent teams.",
    url: "/about",
  },
  alternates: {
    canonical: "/about",
  },
};

export default function AboutPage() {
  return <AboutPageClient />;
}
