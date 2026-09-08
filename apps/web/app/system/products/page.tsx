"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { useAuthStore } from "@multica/core/auth";
import { paths } from "@multica/core/paths";
import { ProductVersionManagementPage } from "@multica/views/system-management";

export default function Page() {
  const router = useRouter();
  const user = useAuthStore((state) => state.user);
  const isLoading = useAuthStore((state) => state.isLoading);

  useEffect(() => {
    if (!isLoading && !user) {
      router.replace(
        `${paths.login()}?next=${encodeURIComponent(paths.system.products())}`,
      );
    }
  }, [isLoading, user, router]);

  // 如果还在加载认证状态或者没有用户，显示加载状态而不是渲染页面
  if (isLoading) {
    return (
      <div className="flex h-screen items-center justify-center">
        <div className="text-muted-foreground">Loading...</div>
      </div>
    );
  }

  // 如果没有用户，返回 null（等待重定向）
  if (!user) {
    return null;
  }

  return <ProductVersionManagementPage />;
}
