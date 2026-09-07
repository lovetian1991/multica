import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type { UpdateSystemSettingsRequest } from "../types";
import { systemSettingsKeys } from "./queries";

export function useUpdateSystemSettings() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateSystemSettingsRequest) =>
      api.updateSystemSettings(data),
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: systemSettingsKeys.detail(),
      });
    },
  });
}
