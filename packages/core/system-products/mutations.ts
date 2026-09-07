import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  CreateProductRequest,
  UpdateProductRequest,
} from "../types";
import { systemProductKeys } from "./queries";

export function useCreateSystemProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateProductRequest) =>
      api.createSystemProduct(data),
    onSettled: () => {
      void queryClient.invalidateQueries({
        queryKey: systemProductKeys.list(),
      });
    },
  });
}

export function useUpdateSystemProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...data }: { id: string } & UpdateProductRequest) =>
      api.updateSystemProduct(id, data),
    onSettled: (_data, _error, variables) => {
      void queryClient.invalidateQueries({
        queryKey: systemProductKeys.list(),
      });
      void queryClient.invalidateQueries({
        queryKey: systemProductKeys.detail(variables.id),
      });
    },
  });
}

export function useDeleteSystemProduct() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api.deleteSystemProduct(id),
    onSettled: (_data, _error, id) => {
      queryClient.removeQueries({
        queryKey: systemProductKeys.detail(id),
      });
      void queryClient.invalidateQueries({
        queryKey: systemProductKeys.list(),
      });
    },
  });
}
