import type { Metadata } from "next";
import { ChangelogPageClient } from "@/features/landing/components/changelog-page-client";

export const metadata: Metadata = {
  title: "Changelog",
  description:
    "See what's new in 鸿翼灵工 — latest features, improvements, and fixes.",
  openGraph: {
    title: "Changelog | 鸿翼灵工",
    description: "Latest updates and releases from 鸿翼灵工.",
    url: "/changelog",
  },
  alternates: {
    canonical: "/changelog",
  },
};

export default function ChangelogPage() {
  return <ChangelogPageClient />;
}
