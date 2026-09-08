"use client";

import { useEffect, useState } from "react";
import { ChevronRight, Folder, FolderOpen, Search, X, Home } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@multica/core/api";
import type { KBFolder } from "@multica/core/types";
import { Button } from "@multica/ui/components/ui/button";
import { Checkbox } from "@multica/ui/components/ui/checkbox";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@multica/ui/components/ui/dialog";
import { Input } from "@multica/ui/components/ui/input";

interface FolderPickerDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (folder: KBFolder) => void;
  selectedFolderId?: string;
}

export function FolderPickerDialog({
  open,
  onOpenChange,
  onSelect,
  selectedFolderId,
}: FolderPickerDialogProps) {
  const [currentFolderId, setCurrentFolderId] = useState<string | undefined>(undefined);
  const [selectedFolder, setSelectedFolder] = useState<KBFolder | null>(null);
  const [folderPath, setFolderPath] = useState<KBFolder[]>([]);
  const [searchQuery, setSearchQuery] = useState("");

  const { data, isLoading, error } = useQuery({
    queryKey: ["kb-folders", currentFolderId],
    queryFn: () => api.getKBFolders(currentFolderId),
    enabled: open,
  });

  const folders = data?.folders || [];

  const filteredFolders = searchQuery.trim()
    ? folders.filter((folder) =>
        folder.name.toLowerCase().includes(searchQuery.toLowerCase()),
      )
    : folders;

  const handleFolderClick = (folder: KBFolder) => {
    setCurrentFolderId(folder.id);
    setFolderPath([...folderPath, folder]);
  };

  const handleBreadcrumbClick = (index: number) => {
    if (index === -1) {
      setCurrentFolderId(undefined);
      setFolderPath([]);
    } else {
      const targetFolder = folderPath[index];
      setCurrentFolderId(targetFolder.id);
      setFolderPath(folderPath.slice(0, index + 1));
    }
  };

  const handleSelect = (folder: KBFolder) => {
    setSelectedFolder(folder);
  };

  const handleConfirm = () => {
    if (selectedFolder) {
      onSelect(selectedFolder);
      onOpenChange(false);
    }
  };

  useEffect(() => {
    if (!open) {
      setCurrentFolderId(undefined);
      setSelectedFolder(null);
      setFolderPath([]);
      setSearchQuery("");
    }
  }, [open]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[85vh]">
        <DialogHeader className="border-b border-surface-border pb-4">
          <DialogTitle className="text-lg">选择文件夹</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-4 py-4">
          {/* 搜索栏 */}
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索文件夹..."
              className="pl-9 pr-9"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground transition-colors"
              >
                <X className="size-4" />
              </button>
            )}
          </div>

          {/* 面包屑导航 */}
          <div className="flex items-center gap-1 px-1 text-sm text-muted-foreground overflow-x-auto">
            <button
              onClick={() => handleBreadcrumbClick(-1)}
              className="flex items-center gap-1 hover:text-foreground transition-colors whitespace-nowrap"
            >
              <Home className="size-3.5" />
              <span>企业内容库</span>
            </button>
            {folderPath.map((folder, index) => (
              <div key={folder.id} className="flex items-center gap-1 whitespace-nowrap">
                <ChevronRight className="size-3.5 shrink-0" />
                <button
                  onClick={() => handleBreadcrumbClick(index)}
                  className="hover:text-foreground transition-colors truncate max-w-[120px]"
                  title={folder.name}
                >
                  {folder.name}
                </button>
              </div>
            ))}
          </div>

          {/* 文件夹列表 */}
          <div className="rounded-lg border border-surface-border overflow-hidden">
            <div className="h-[400px] overflow-y-auto">
              {isLoading ? (
                <div className="flex items-center justify-center h-full text-muted-foreground">
                  <div className="flex flex-col items-center gap-2">
                    <div className="size-8 animate-spin rounded-full border-2 border-primary border-t-transparent" />
                    <span className="text-sm">加载中...</span>
                  </div>
                </div>
              ) : error ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center text-destructive">
                    <p className="text-sm font-medium">加载失败</p>
                    <p className="text-xs mt-1 text-muted-foreground">请检查网络连接或稍后重试</p>
                  </div>
                </div>
              ) : filteredFolders.length === 0 ? (
                <div className="flex items-center justify-center h-full">
                  <div className="text-center text-muted-foreground">
                    <Folder className="mx-auto size-12 mb-3 opacity-40" />
                    <p className="text-sm font-medium">
                      {searchQuery ? "没有找到匹配的文件夹" : "此文件夹为空"}
                    </p>
                  </div>
                </div>
              ) : (
                <div className="divide-y divide-surface-border">
                  {filteredFolders.map((folder) => {
                    const isSelected = selectedFolder?.id === folder.id;

                    return (
                      <div
                        key={folder.id}
                        className={`group flex items-center gap-3 px-4 py-3 hover:bg-muted/50 transition-colors cursor-pointer ${
                          isSelected ? "bg-muted" : ""
                        }`}
                        onClick={() => handleSelect(folder)}
                      >
                        <Checkbox
                          checked={isSelected}
                          onCheckedChange={() => handleSelect(folder)}
                          onClick={(e) => e.stopPropagation()}
                          className="shrink-0"
                        />
                        <div className="flex items-center gap-2 flex-1 min-w-0">
                          <Folder className="size-5 shrink-0 text-amber-500" />
                          <span className="text-sm font-medium truncate">{folder.name}</span>
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleFolderClick(folder);
                          }}
                          className="shrink-0 p-1.5 rounded hover:bg-muted transition-colors opacity-0 group-hover:opacity-100"
                          title="打开文件夹"
                        >
                          <ChevronRight className="size-4 text-muted-foreground" />
                        </button>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>

          {/* 已选择提示 */}
          {selectedFolder && (
            <div className="rounded-lg bg-primary/5 border border-primary/20 px-4 py-3">
              <div className="flex items-start gap-3">
                <div className="rounded-md bg-primary/10 p-2 shrink-0">
                  <FolderOpen className="size-4 text-primary" />
                </div>
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-muted-foreground mb-1">已选择:</p>
                  <p className="text-sm font-medium truncate" title={selectedFolder.name}>
                    {selectedFolder.name}
                  </p>
                </div>
              </div>
            </div>
          )}
        </div>

        <DialogFooter className="border-t border-surface-border pt-4">
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button onClick={handleConfirm} disabled={!selectedFolder}>
            确定选择
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
