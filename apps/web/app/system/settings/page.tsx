"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@multica/core/auth";
import { paths } from "@multica/core/paths";
import { SystemSettingsPage } from "@multica/views/system-management";

export default function Page() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const isLoading = useAuthStore((state) => state.isLoading);

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace(
        `${paths.login()}?next=${encodeURIComponent(paths.system.settings())}`,
      );
    }
  }, [isLoading, user, router]);

  if (isLoading || !user) return null;

  return <SystemSettingsPage />;
}
