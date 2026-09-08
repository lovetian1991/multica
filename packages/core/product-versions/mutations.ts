import { useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import type {
  CreateProductVersionRequest,
  UpdateProductVersionRequest,
} from "../types";
import { productVersionKeys } from "./queries";

export function useCreateProductVersion(productId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: CreateProductVersionRequest) =>
      api.createSystemProductVersion(productId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: productVersionKeys.list(productId),
      });
    },
  });
}

export function useUpdateProductVersion(productId: string, versionId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (data: UpdateProductVersionRequest) =>
      api.updateSystemProductVersion(productId, versionId, data),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: productVersionKeys.list(productId),
      });
      queryClient.invalidateQueries({
        queryKey: productVersionKeys.detail(productId, versionId),
      });
    },
  });
}

export function useDeleteProductVersion(productId: string) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (versionId: string) => api.deleteSystemProductVersion(productId, versionId),
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: productVersionKeys.list(productId),
      });
    },
  });
}
