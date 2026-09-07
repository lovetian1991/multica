import { queryOptions } from "@tanstack/react-query";
import { api } from "../api";

export const systemSettingsKeys = {
  all: () => ["system-settings"] as const,
  detail: () => [...systemSettingsKeys.all(), "detail"] as const,
};

export function systemSettingsOptions() {
  return queryOptions({
    queryKey: systemSettingsKeys.detail(),
    queryFn: () => api.getSystemSettings(),
  });
}
