"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@multica/core/auth";
import { paths } from "@multica/core/paths";
import { ProjectManagementPage } from "@multica/views/work-orders";

export default function Page() {
  const router = useRouter();
  const user = useAuthStore((s) => s.user);
  const loading = useAuthStore((s) => s.isLoading);
  useEffect(() => {
    if (!loading && !user) router.replace(`${paths.login()}?next=${encodeURIComponent(paths.system.projects())}`);
  }, [loading, user, router]);
  if (loading || !user) return null;
  return <ProjectManagementPage />;
}
