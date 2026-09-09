"use client";

import { useEffect, useState, type ReactElement } from "react";
import { ChevronRight, Folder, FolderOpen, Home, Loader2, MoreHorizontal } from "lucide-react";
import { api } from "@multica/core/api";
import type { KBFolder } from "@multica/core/types";
import { Button } from "@multica/ui/components/ui/button";
import { Checkbox } from "@multica/ui/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@multica/ui/components/ui/dialog";
import { cn } from "@multica/ui/lib/utils";
import { useT } from "../i18n";

const ROOT_FOLDER_ID = "1";

interface FolderPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (folder: KBFolder) => void;
  selectedFolderId?: string;
}

interface TreeNode {
  folder: KBFolder;
  children?: TreeNode[];
  expanded: boolean;
  childTotalCount: number;
  childPage: number;
  loading: boolean;
}

function createTreeNodes(folders: KBFolder[]): TreeNode[] {
  return folders.map((folder) => ({
    folder,
    expanded: false,
    childTotalCount: 0,
    childPage: 0,
    loading: false,
  }));
}

function updateNodeInTree(
  nodes: TreeNode[],
  targetId: string,
  updater: (node: TreeNode) => Partial<TreeNode>,
): TreeNode[] {
  return nodes.map((node) => {
    if (node.folder.id === targetId) return { ...node, ...updater(node) };
    if (node.children) {
      return { ...node, children: updateNodeInTree(node.children, targetId, updater) };
    }
    return node;
  });
}

function appendUniqueNodes(current: TreeNode[], incoming: TreeNode[]): TreeNode[] {
  const existingIds = new Set(current.map((node) => node.folder.id));
  return [...current, ...incoming.filter((node) => !existingIds.has(node.folder.id))];
}

export function FolderPickerDialog({
  open,
  onOpenChange,
  onSelect,
  selectedFolderId,
}: FolderPickerDialogProps) {
  const { t } = useT("settings");
  const [treeData, setTreeData] = useState<TreeNode[]>([]);
  const [rootTotalCount, setRootTotalCount] = useState(0);
  const [rootPage, setRootPage] = useState(0);
  const [selectedFolder, setSelectedFolder] = useState<KBFolder | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadingMoreRoot, setLoadingMoreRoot] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setTreeData([]);
      setRootTotalCount(0);
      setRootPage(0);
      setSelectedFolder(null);
      setLoading(false);
      setLoadingMoreRoot(false);
      setError(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);
    void api.getKBFolders(ROOT_FOLDER_ID, 1)
      .then((response) => {
        if (cancelled) return;
        setTreeData(createTreeNodes(response.folders));
        setRootTotalCount(response.totalCount);
        setRootPage(1);
        setSelectedFolder(response.folders.find((folder) => folder.id === selectedFolderId) ?? null);
      })
      .catch(() => {
        if (!cancelled) setError(t(($) => $.products.folder_picker.load_failed));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [open, selectedFolderId, t]);

  const loadChildren = async (node: TreeNode, page: number) => {
    if (node.loading) return;
    setError(null);
    setTreeData((current) => updateNodeInTree(current, node.folder.id, () => ({ loading: true })));
    try {
      const response = await api.getKBFolders(node.folder.id, page);
      const incoming = createTreeNodes(response.folders);
      setTreeData((current) => updateNodeInTree(current, node.folder.id, (currentNode) => ({
        children: page === 1 ? incoming : appendUniqueNodes(currentNode.children ?? [], incoming),
        expanded: true,
        childTotalCount: response.totalCount,
        childPage: page,
        loading: false,
      })));
      setSelectedFolder((current) => current ?? response.folders.find((folder) => folder.id === selectedFolderId) ?? null);
    } catch {
      setError(t(($) => $.products.folder_picker.load_failed));
      setTreeData((current) => updateNodeInTree(current, node.folder.id, () => ({ loading: false })));
    }
  };

  const toggleNode = (node: TreeNode) => {
    if (node.expanded) {
      setTreeData((current) => updateNodeInTree(current, node.folder.id, () => ({ expanded: false })));
    } else if (node.children === undefined) {
      void loadChildren(node, 1);
    } else {
      setTreeData((current) => updateNodeInTree(current, node.folder.id, () => ({ expanded: true })));
    }
  };

  const loadMoreRoot = async () => {
    if (loadingMoreRoot) return;
    setLoadingMoreRoot(true);
    setError(null);
    const nextPage = rootPage + 1;
    try {
      const response = await api.getKBFolders(ROOT_FOLDER_ID, nextPage);
      setTreeData((current) => appendUniqueNodes(current, createTreeNodes(response.folders)));
      setRootTotalCount(response.totalCount);
      setRootPage(nextPage);
      setSelectedFolder((current) => current ?? response.folders.find((folder) => folder.id === selectedFolderId) ?? null);
    } catch {
      setError(t(($) => $.products.folder_picker.load_failed));
    } finally {
      setLoadingMoreRoot(false);
    }
  };

  const handleConfirm = () => {
    if (selectedFolder) {
      onSelect(selectedFolder);
      onOpenChange(false);
    }
  };

  const renderLoadMore = (key: string, level: number, busy: boolean, onClick: () => void) => (
    <button
      key={key}
      type="button"
      disabled={busy}
      className="flex w-full items-center gap-2 px-4 py-2 text-left text-body text-primary transition-colors hover:bg-muted/50 disabled:opacity-50"
      style={{ paddingLeft: `${level * 20 + 16}px` }}
      onClick={onClick}
    >
      {busy ? <Loader2 className="size-4 shrink-0 animate-spin" /> : <MoreHorizontal className="size-4 shrink-0" />}
      <span>{t(($) => $.products.folder_picker.load_more)}</span>
    </button>
  );

  const renderTree = (nodes: TreeNode[], level = 0): ReactElement[] => nodes.flatMap((node) => {
    const isSelected = selectedFolder?.id === node.folder.id;
    const items: ReactElement[] = [
      <div
        key={node.folder.id}
        className={cn(
          "flex min-w-max cursor-pointer items-center gap-2 px-4 py-2 text-body transition-colors hover:bg-muted/50",
          isSelected && "bg-muted font-medium text-foreground hover:bg-muted",
        )}
        style={{ paddingLeft: `${level * 20 + 16}px` }}
        onClick={() => setSelectedFolder(node.folder)}
      >
        <button
          type="button"
          disabled={node.loading}
          className="shrink-0 text-muted-foreground disabled:opacity-50"
          aria-label={t(($) => node.expanded ? $.products.folder_picker.collapse : $.products.folder_picker.expand)}
          onClick={(event) => {
            event.stopPropagation();
            toggleNode(node);
          }}
        >
          {node.loading ? <Loader2 className="size-4 animate-spin" /> : <ChevronRight className={cn("size-4 transition-transform", node.expanded && "rotate-90")} />}
        </button>
        <Checkbox
          checked={isSelected}
          onCheckedChange={() => setSelectedFolder(node.folder)}
          onClick={(event) => event.stopPropagation()}
          className="shrink-0"
        />
        {node.expanded ? <FolderOpen className="size-4 shrink-0 text-muted-foreground" /> : <Folder className="size-4 shrink-0 text-muted-foreground" />}
        <span className="whitespace-nowrap" title={node.folder.name}>{node.folder.name}</span>
      </div>,
    ];
    if (node.expanded && node.children) {
      items.push(...renderTree(node.children, level + 1));
      if (node.children.length < node.childTotalCount) {
        items.push(renderLoadMore(`${node.folder.id}-more`, level + 1, node.loading, () => void loadChildren(node, node.childPage + 1)));
      }
    }
    return items;
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex max-h-[85vh] !w-[calc(100vw-2rem)] !max-w-3xl flex-col overflow-hidden">
        <DialogHeader className="shrink-0 border-b border-surface-border pb-4">
          <DialogTitle>{t(($) => $.products.folder_picker.title)}</DialogTitle>
        </DialogHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-hidden py-4">
          <div className="flex items-center gap-1 px-1 text-body text-muted-foreground">
            <Home className="size-3.5" />
            <span>{t(($) => $.products.folder_picker.library_root)}</span>
          </div>
          <div className="min-h-0 flex-1 overflow-hidden rounded-md border border-surface-border">
            <div className="h-[400px] max-h-[45vh] min-h-[12rem] overflow-auto">
              {loading ? (
                <div className="flex h-full items-center justify-center text-muted-foreground">
                  <div className="flex flex-col items-center gap-2"><Loader2 className="size-8 animate-spin" /><span className="text-body">{t(($) => $.products.folder_picker.loading)}</span></div>
                </div>
              ) : error && treeData.length === 0 ? (
                <div className="flex h-full items-center justify-center px-6 text-center text-body text-destructive">{error}</div>
              ) : treeData.length === 0 ? (
                <div className="flex h-full items-center justify-center"><div className="text-center text-muted-foreground"><Folder className="mx-auto mb-3 size-12 opacity-40" /><p className="text-body font-medium">{t(($) => $.products.folder_picker.empty)}</p></div></div>
              ) : (
                <div className="min-w-max py-1">
                  {error && <p className="px-4 py-2 text-caption text-destructive">{error}</p>}
                  {renderTree(treeData)}
                  {treeData.length < rootTotalCount && renderLoadMore("root-more", 0, loadingMoreRoot, () => void loadMoreRoot())}
                </div>
              )}
            </div>
          </div>
          {selectedFolder && (
            <div className="flex min-w-0 shrink-0 items-center gap-3 border-l-2 border-primary px-3 py-2">
              <FolderOpen className="size-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1"><p className="text-caption text-muted-foreground">{t(($) => $.products.folder_picker.selected)}</p><p className="truncate text-body font-medium" title={selectedFolder.name}>{selectedFolder.name}</p></div>
            </div>
          )}
        </div>
        <DialogFooter className="shrink-0 border-t border-surface-border pt-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>{t(($) => $.products.folder_picker.cancel)}</Button>
          <Button onClick={handleConfirm} disabled={!selectedFolder}>{t(($) => $.products.folder_picker.confirm)}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
