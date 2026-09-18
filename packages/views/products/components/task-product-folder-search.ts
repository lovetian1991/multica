import type { KBFolder } from "@multica/core/types";

/** Extra pages fetched automatically when the current loaded set has no match. */
export const FOLDER_SEARCH_AUTO_LOAD_PAGES = 2;

/**
 * Debounce before the first auto-fetched page of a query so typing does not
 * fan out a request per keystroke. Later pages of the same query load immediately.
 */
export const FOLDER_SEARCH_AUTO_LOAD_DELAY_MS = 300;

export function folderMatchesQuery(
  folder: Pick<KBFolder, "id" | "name">,
  query: string,
): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;
  return (
    folder.name.toLowerCase().includes(normalized) ||
    folder.id.toLowerCase().includes(normalized)
  );
}

export function filterFoldersByQuery<T extends Pick<KBFolder, "id" | "name">>(
  folders: T[],
  query: string,
): T[] {
  if (!query.trim()) return folders;
  return folders.filter((folder) => folderMatchesQuery(folder, query));
}

export function shouldAutoLoadMoreFolders(input: {
  query: string;
  matchCount: number;
  loadedCount: number;
  totalCount: number;
  autoLoadedPages: number;
  loading: boolean;
}): boolean {
  if (input.loading) return false;
  if (!input.query.trim()) return false;
  if (input.matchCount > 0) return false;
  if (input.loadedCount <= 0) return false;
  if (input.loadedCount >= input.totalCount) return false;
  if (input.autoLoadedPages >= FOLDER_SEARCH_AUTO_LOAD_PAGES) return false;
  return true;
}

export function folderSearchAutoLoadDelayMs(autoLoadedPages: number): number {
  return autoLoadedPages === 0 ? FOLDER_SEARCH_AUTO_LOAD_DELAY_MS : 0;
}
