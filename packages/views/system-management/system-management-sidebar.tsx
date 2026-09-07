"use client";

import type { LucideIcon } from "lucide-react";
import {
  Database,
  Package,
  Settings2,
  ShieldCheck,
  Users,
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
  key: "products" | "workspaces" | "users" | "settings";
  href?: string;
  icon: LucideIcon;
}

const catalogItems: SystemMenuItem[] = [
  { key: "products", href: paths.system.products(), icon: Package },
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
          productLabel={t(($) => $.system_management.products)}
          workspaceLabel={t(($) => $.system_management.workspaces)}
          userLabel={t(($) => $.system_management.users)}
          settingsLabel={t(($) => $.system_management.settings)}
          comingSoonLabel={t(($) => $.system_management.coming_soon)}
        />
        <SystemMenuGroup
          label={t(($) => $.system_management.configuration)}
          items={configurationItems}
          pathname={pathname}
          productLabel={t(($) => $.system_management.products)}
          workspaceLabel={t(($) => $.system_management.workspaces)}
          userLabel={t(($) => $.system_management.users)}
          settingsLabel={t(($) => $.system_management.settings)}
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
  productLabel,
  workspaceLabel,
  userLabel,
  settingsLabel,
  comingSoonLabel,
}: {
  label: string;
  items: SystemMenuItem[];
  pathname: string;
  productLabel: string;
  workspaceLabel: string;
  userLabel: string;
  settingsLabel: string;
  comingSoonLabel: string;
}) {
  const labels = {
    products: productLabel,
    workspaces: workspaceLabel,
    users: userLabel,
    settings: settingsLabel,
  } satisfies Record<SystemMenuItem["key"], string>;

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
