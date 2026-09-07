"use client";

import type { ReactNode } from "react";
import {
  SidebarInset,
  SidebarProvider,
} from "@multica/ui/components/ui/sidebar";
import { NavigationProgress } from "../layout";
import { SystemManagementSidebar } from "./system-management-sidebar";

interface SystemManagementLayoutProps {
  children: ReactNode;
}

export function SystemManagementLayout({
  children,
}: SystemManagementLayoutProps) {
  return (
    <SidebarProvider className="h-svh bg-app-shell">
      <SystemManagementSidebar />
      <SidebarInset className="relative overflow-hidden">
        <NavigationProgress />
        {children}
      </SidebarInset>
    </SidebarProvider>
  );
}
