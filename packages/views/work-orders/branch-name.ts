import { pinyin } from "pinyin-pro";

const MAX_REPO_BRANCH_LENGTH = 200;

function segment(value: string): string {
  // pinyin-pro leaves non-Chinese text untouched, so this is safe for ASCII names.
  const base = pinyin(value, { toneType: "none", separator: "-", nonZh: "consecutive", v: true });
  const slug = base
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/[-._]{2,}/g, "-")
    .replace(/^[-._]+|[-._]+$/g, "");
  return slug || "x";
}

/** Customer project branches follow `proj-<project pinyin>-<product version>`. */
export function projectBranchName(projectName: string, versionName: string): string {
  const name = `proj-${segment(projectName)}-${segment(versionName)}`;
  return name.slice(0, MAX_REPO_BRANCH_LENGTH).replace(/[-._]+$/g, "");
}
