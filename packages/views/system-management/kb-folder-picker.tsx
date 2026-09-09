"use client";

import { useEffect, useState, type ReactElement } from "react";
import { ChevronRight, Folder, FolderOpen, Loader2, X } from "lucide-react";
import { api } from "@multica/core/api";
import type { KBFolder } from "@multica/core/types";
import { Button } from "@multica/ui/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@multica/ui/components/ui/dialog";
import { Input } from "@multica/ui/components/ui/input";
import { cn } from "@multica/ui/lib/utils";

interface KBFolderPickerProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (folderId: string, folderName: string) => void;
  selectedFolderId?: string;
}

interface FolderNode {
  folder: KBFolder;
  children?: FolderNode[];
  expanded: boolean;
  loading: boolean;
}

export function KBFolderPicker({
  open,
  onOpenChange,
  onSelect,
}: KBFolderPickerProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [rootFolders, setRootFolders] = useState<FolderNode[]>([]);
  const [selectedFolder, setSelectedFolder] = useState<KBFolder | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Load root folders when dialog opens
  useEffect(() => {
    if (!open) return;
    loadRootFolders();
  }, [open]);

  const loadRootFolders = async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await api.getKBFolders();
      const nodes: FolderNode[] = response.folders.map((folder) => ({
        folder,
        expanded: false,
        loading: false,
      }));
      setRootFolders(nodes);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载文件夹失败");
    } finally {
      setLoading(false);
    }
  };

  const loadChildren = async (node: FolderNode) => {
    if (node.loading || node.children) return;

    const updateNode = (nodes: FolderNode[]): FolderNode[] => {
      return nodes.map((n) => {
        if (n.folder.id === node.folder.id) {
          return { ...n, loading: true };
        }
        if (n.children) {
          return { ...n, children: updateNode(n.children) };
        }
        return n;
      });
    };

    setRootFolders(updateNode(rootFolders));

    try {
      const response = await api.getKBFolders(node.folder.id);
      const childNodes: FolderNode[] = response.folders.map((folder) => ({
        folder,
        expanded: false,
        loading: false,
      }));

      const setChildren = (nodes: FolderNode[]): FolderNode[] => {
        return nodes.map((n) => {
          if (n.folder.id === node.folder.id) {
            return { ...n, children: childNodes, loading: false, expanded: true };
          }
          if (n.children) {
            return { ...n, children: setChildren(n.children) };
          }
          return n;
        });
      };

      setRootFolders(setChildren(rootFolders));
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载子文件夹失败");
      const resetLoading = (nodes: FolderNode[]): FolderNode[] => {
        return nodes.map((n) => {
          if (n.folder.id === node.folder.id) {
            return { ...n, loading: false };
          }
          if (n.children) {
            return { ...n, children: resetLoading(n.children) };
          }
          return n;
        });
      };
      setRootFolders(resetLoading(rootFolders));
    }
  };

  const toggleFolder = (node: FolderNode) => {
    if (node.expanded) {
      // Collapse
      const collapse = (nodes: FolderNode[]): FolderNode[] => {
        return nodes.map((n) => {
          if (n.folder.id === node.folder.id) {
            return { ...n, expanded: false };
          }
          if (n.children) {
            return { ...n, children: collapse(n.children) };
          }
          return n;
        });
      };
      setRootFolders(collapse(rootFolders));
    } else {
      // Expand and load if needed
      if (!node.children) {
        loadChildren(node);
      } else {
        const expand = (nodes: FolderNode[]): FolderNode[] => {
          return nodes.map((n) => {
            if (n.folder.id === node.folder.id) {
              return { ...n, expanded: true };
            }
            if (n.children) {
              return { ...n, children: expand(n.children) };
            }
            return n;
          });
        };
        setRootFolders(expand(rootFolders));
      }
    }
  };

  const handleSelect = () => {
    if (!selectedFolder) return;
    onSelect(selectedFolder.id, selectedFolder.name);
    onOpenChange(false);
  };

  const renderFolderTree = (nodes: FolderNode[], level = 0): ReactElement[] => {
    return nodes
      .filter((node) => {
        if (!searchQuery) return true;
        return node.folder.name.toLowerCase().includes(searchQuery.toLowerCase());
      })
      .map((node) => (
        <div key={node.folder.id}>
          <button
            type="button"
            className={cn(
              "flex w-full items-center gap-2 px-3 py-2 text-left text-body hover:bg-muted/50 transition-colors",
              selectedFolder?.id === node.folder.id && "bg-muted",
            )}
            style={{ paddingLeft: `${level * 16 + 12}px` }}
            onClick={() => {
              setSelectedFolder(node.folder);
              toggleFolder(node);
            }}
          >
            <ChevronRight
              className={cn(
                "size-4 shrink-0 text-muted-foreground transition-transform",
                node.expanded && "rotate-90",
                !node.children && node.loading && "animate-spin",
              )}
            />
            {node.expanded ? (
              <FolderOpen className="size-4 shrink-0 text-muted-foreground" />
            ) : (
              <Folder className="size-4 shrink-0 text-muted-foreground" />
            )}
            <span className="min-w-0 flex-1 truncate">{node.folder.name}</span>
          </button>
          {node.expanded && node.children && renderFolderTree(node.children, level + 1)}
        </div>
      ));
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>选择文件夹</DialogTitle>
          <DialogDescription>选择一个文件夹作为版本存储位置</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="relative">
            <Input
              placeholder="输入文件名称搜索"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="pr-8"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            )}
          </div>

          <div className="rounded-lg border border-surface-border bg-card">
            {loading ? (
              <div className="flex items-center justify-center py-12">
                <Loader2 className="size-6 animate-spin text-muted-foreground" />
              </div>
            ) : error ? (
              <div className="px-4 py-12 text-center text-body text-destructive">{error}</div>
            ) : rootFolders.length === 0 ? (
              <div className="px-4 py-12 text-center text-body text-muted-foreground">
                没有找到文件夹
              </div>
            ) : (
              <div className="h-[400px] overflow-y-auto">
                <div className="py-2">{renderFolderTree(rootFolders)}</div>
              </div>
            )}
          </div>

          {selectedFolder && (
            <div className="rounded-lg border border-surface-border bg-muted/20 px-4 py-3">
              <p className="text-caption text-muted-foreground">已选择:</p>
              <p className="mt-1 text-body font-medium">{selectedFolder.name}</p>
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleSelect} disabled={!selectedFolder}>
            确定
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
