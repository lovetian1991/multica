"use client";

import type { LucideIcon } from "lucide-react";
import {
  Database,
  Package,
  Settings2,
  ShieldCheck,
  Users,
  Workflow,
} from "lucide-react";
import { useT } from "../i18n";
import { AppLink, useNavigation } from "../navigation";
import { paths } from "@multica/core/paths";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from "@multica/ui/components/ui/sidebar";

interface SystemMenuItem {
  key: "products" | "process_templates" | "workspaces" | "users" | "settings";
  href?: string;
  icon: LucideIcon;
}

const catalogItems: SystemMenuItem[] = [
  { key: "products", href: paths.system.products(), icon: Package },
  { key: "process_templates", href: paths.system.processTemplates(), icon: Workflow },
  { key: "workspaces", icon: Database },
];

const configurationItems: SystemMenuItem[] = [
  { key: "users", icon: Users },
  { key: "settings", href: paths.system.settings(), icon: Settings2 },
];

function isActivePath(pathname: string, href: string) {
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SystemManagementSidebar() {
  const { t } = useT("settings");
  const { pathname } = useNavigation();

  return (
    <Sidebar variant="inset">
      <SidebarHeader className="gap-3 py-3">
        <div className="flex items-center gap-2 px-2 text-body font-semibold">
          <ShieldCheck className="size-4 text-brand" />
          <span className="truncate">
            {t(($) => $.system_management.title)}
          </span>
        </div>
      </SidebarHeader>

      <SidebarContent>
        <SystemMenuGroup
          label={t(($) => $.system_management.catalog)}
          items={catalogItems}
          pathname={pathname}
          labels={{
            products: t(($) => $.system_management.products),
            process_templates: t(($) => $.system_management.process_templates),
            workspaces: t(($) => $.system_management.workspaces),
            users: t(($) => $.system_management.users),
            settings: t(($) => $.system_management.settings),
          }}
          comingSoonLabel={t(($) => $.system_management.coming_soon)}
        />
        <SystemMenuGroup
          label={t(($) => $.system_management.configuration)}
          items={configurationItems}
          pathname={pathname}
          labels={{
            products: t(($) => $.system_management.products),
            process_templates: t(($) => $.system_management.process_templates),
            workspaces: t(($) => $.system_management.workspaces),
            users: t(($) => $.system_management.users),
            settings: t(($) => $.system_management.settings),
          }}
          comingSoonLabel={t(($) => $.system_management.coming_soon)}
        />
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}

function SystemMenuGroup({
  label,
  items,
  pathname,
  labels,
  comingSoonLabel,
}: {
  label: string;
  items: SystemMenuItem[];
  pathname: string;
  labels: Record<SystemMenuItem["key"], string>;
  comingSoonLabel: string;
}) {
  return (
    <SidebarGroup>
      <SidebarGroupLabel>{label}</SidebarGroupLabel>
      <SidebarGroupContent>
        <SidebarMenu className="gap-0.5">
          {items.map((item) => {
            const Icon = item.icon;
            const labelText = labels[item.key];
            const isActive = item.href
              ? isActivePath(pathname, item.href)
              : false;

            return (
              <SidebarMenuItem key={item.key}>
                {item.href ? (
                  <SidebarMenuButton
                    isActive={isActive}
                    render={<AppLink href={item.href} />}
                    className="text-muted-foreground hover:not-data-active:bg-sidebar-accent/70 data-active:bg-sidebar-accent data-active:text-sidebar-accent-foreground"
                  >
                    <Icon />
                    <span>{labelText}</span>
                  </SidebarMenuButton>
                ) : (
                  <SidebarMenuButton
                    disabled
                    title={comingSoonLabel}
                    className="text-muted-foreground"
                  >
                    <Icon />
                    <span>{labelText}</span>
                  </SidebarMenuButton>
                )}
              </SidebarMenuItem>
            );
          })}
        </SidebarMenu>
      </SidebarGroupContent>
    </SidebarGroup>
  );
}
