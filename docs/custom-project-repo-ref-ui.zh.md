# 项目 Git 仓库分支/ref UI 定制方案

## 背景

当前在“新建项目”弹窗中选择 **GitHub 仓库** 时，界面只允许选择或粘贴 Git URL。虽然 UI 文案叫 GitHub 仓库，但底层资源类型是 `github_repo`，实际可以保存任意 daemon 能访问的 Git URL，包括私有 GitLab、Forgejo、Gitea。

当前创建项目时保存的资源形状是：

```json
{
  "resource_type": "github_repo",
  "resource_ref": {
    "url": "git@gitlab.example.com:group/project.git"
  }
}
```

后端已经支持 `ref` 字段，位置在 `server/internal/handler/project_resource.go`：

```go
type githubRepoRef struct {
    URL               string `json:"url"`
    DefaultBranchHint string `json:"default_branch_hint,omitempty"`
    Ref               string `json:"ref,omitempty"`
}
```

如果没有指定 `ref`，daemon 会在创建 worktree 时使用远端默认分支。默认分支解析由 `server/internal/daemon/repocache/cache.go` 中的 `CreateWorktree` 负责，大致顺序是：`origin/HEAD`、`origin/main`、`origin/master`、bare HEAD hint、单一 `origin/*` 候选。

本方案目标是在 UI 中显式支持指定分支、tag 或 commit，使项目下的 issue 被智能体处理时，从用户指定的 base ref 开始创建 task 分支。

## 目标体验

### 新建项目弹窗

在“GitHub 仓库”标签下，用户选择或粘贴仓库 URL 后，可以为每个仓库填写一个可选的 **分支/ref**。

建议 UI 文案：

- 字段 label：`分支/ref`
- placeholder：`main、develop、v1.2.0 或 commit SHA`
- 辅助说明：`留空时使用仓库默认分支。`

如果用户不填，行为保持现状。

### 项目资源面板

项目创建后，在项目详情页的资源列表中，Git 仓库资源应显示当前 ref：

```text
git@gitlab.example.com:group/project.git @ develop
```

如果没有 ref，只显示仓库短名或 URL。

资源编辑入口应支持修改 ref：

- 修改 ref 后，后续新 task 从新 ref 开始。
- 已经创建或正在执行的 task 不受影响。
- 清空 ref 后回到远端默认分支。

## 数据结构

继续复用现有 `github_repo` resource type，不新增数据库字段，不新增 resource type。

目标 JSON：

```json
{
  "resource_type": "github_repo",
  "resource_ref": {
    "url": "git@gitlab.example.com:group/project.git",
    "ref": "develop"
  }
}
```

可选保留 `default_branch_hint`：

```json
{
  "url": "git@gitlab.example.com:group/project.git",
  "ref": "develop",
  "default_branch_hint": "main"
}
```

注意：`default_branch_hint` 只是给智能体的提示，不是强制 checkout 目标。真正决定 checkout base 的字段是 `ref`。

## 当前链路

### 创建项目

相关文件：

- `packages/views/modals/create-project.tsx`
- `packages/core/projects/mutations.ts`
- `packages/core/api/client.ts`
- `server/internal/handler/project.go`
- `server/internal/handler/project_resource.go`

当前 `create-project.tsx` 中 `selectedRepos` 是 `string[]`，只保存 URL。提交时组装为：

```ts
resources = selectedRepos.map((url) => ({
  resource_type: "github_repo" as const,
  resource_ref: { url },
}));
```

需要改成保存 URL + ref。

### 项目详情资源面板

相关文件：

- `packages/views/projects/components/project-resources-section.tsx`
- `packages/core/projects/mutations.ts`
- `packages/core/types` 中的 `ProjectResource` / `GithubRepoResourceRef` 类型
- `packages/views/locales/*/projects.json`

当前资源面板已经能展示 `ref.ref`，例如：

```ts
const display = resource.label || (ref.ref ? `${githubShortLabel(ref.url)} @ ${ref.ref}` : githubShortLabel(ref.url));
```

但添加资源输入框只提交 URL：

```ts
await createResource.mutateAsync({
  resource_type: "github_repo",
  resource_ref: { url },
});
```

需要在添加和编辑流程中加入 `ref`。

### daemon checkout

相关文件：

- `server/internal/daemon/daemon.go`
- `server/internal/daemon/repocache/cache.go`

daemon 侧已经有 task-scoped ref 记录：

```go
ws.taskRepoRefs[taskID][url] = strings.TrimSpace(repo.Ref)
```

创建 worktree 时 `WorktreeParams.Ref` 会作为可选 branch/tag/commit base。`Ref` 为空时使用远端默认分支。

因此本定制主要是 UI 和前端类型/提交 payload 改动，后端和 daemon 主路径已经具备基础能力。

## 具体改动方案

### 1. 调整前端类型

检查并更新 `packages/core/types` 中的 `GithubRepoResourceRef`。目标形状：

```ts
export interface GithubRepoResourceRef {
  url: string;
  ref?: string;
  default_branch_hint?: string;
}
```

如果类型已经包含 `ref`，只需要复用，不要新增平行类型。

### 2. 改造新建项目弹窗状态

文件：`packages/views/modals/create-project.tsx`

将：

```ts
const [selectedRepos, setSelectedRepos] = useState<string[]>([]);
```

改成类似：

```ts
type SelectedRepoResource = {
  url: string;
  ref: string;
};

const [selectedRepos, setSelectedRepos] = useState<SelectedRepoResource[]>([]);
```

选择已有工作区仓库时默认 `ref: ""`。

粘贴自定义 URL 时也保存 `{ url, ref: "" }`，并在 UI 中提供 ref 输入框。

提交时组装：

```ts
resources = selectedRepos.map((repo) => ({
  resource_type: "github_repo" as const,
  resource_ref: {
    url: repo.url,
    ...(repo.ref.trim() ? { ref: repo.ref.trim() } : {}),
  },
}));
```

### 3. 新建项目弹窗 UI

建议把每个已选仓库渲染为一行或一个紧凑块：

```text
[repo short label]                         [移除]
分支/ref  [develop                         ]
```

如果当前弹窗空间紧张，也可以在 popover 中选择仓库后，在列表下方展示选中仓库及 ref 输入框。

设计约束：

- 不要让 ref 输入撑高整个 footer。
- ref 是可选字段，不要阻塞创建项目。
- 输入框应支持长 commit SHA，使用 `truncate` 或横向可滚动输入。
- label 和 placeholder 走 i18n，不写死中文。

### 4. 项目资源面板添加资源时支持 ref

文件：`packages/views/projects/components/project-resources-section.tsx`

当前 `AddRepoUrlForm` 只有 URL 输入。可以改成：

```ts
function AddRepoUrlForm({
  onSubmit,
}: {
  onSubmit: (input: { url: string; ref?: string }) => Promise<void> | void;
})
```

内部维护：

```ts
const [url, setUrl] = useState("");
const [ref, setRef] = useState("");
```

提交时：

```ts
await onSubmit({
  url: trimmedUrl,
  ref: ref.trim() || undefined,
});
```

`handleAttach` 改为接收对象：

```ts
const handleAttach = async ({ url, ref }: { url: string; ref?: string }) => {
  await createResource.mutateAsync({
    resource_type: "github_repo",
    resource_ref: {
      url,
      ...(ref ? { ref } : {}),
    },
  });
};
```

从工作区仓库列表点击添加时，可以先保持不带 ref；如果需要完整体验，可以点击后弹出一个小编辑行让用户补 ref。

### 5. 项目资源面板编辑 ref

当前资源列表里已有 local directory 的编辑模式。Git repo 可以新增一个轻量编辑入口：

- 行内铅笔按钮。
- 打开小弹窗或 popover。
- 字段：URL 只读或可编辑，ref 可编辑。
- 保存时调用 `updateResource.mutateAsync`。

保存 payload：

```ts
await updateResource.mutateAsync({
  resourceId: resource.id,
  data: {
    resource_ref: {
      ...resource.resource_ref,
      ...(nextRef.trim()
        ? { ref: nextRef.trim() }
        : { ref: undefined }),
    },
  },
});
```

实现时要注意：JSON 序列化会丢弃 `undefined`，如果要清空已存在的 `ref`，需要显式构造一个没有 `ref` 键的新对象：

```ts
const nextRef = { ...resource.resource_ref };
delete nextRef.ref;
if (trimmedRef) nextRef.ref = trimmedRef;
```

### 6. 后端校验可以先不改，但建议增强

当前后端 `validateGithubRepoRef` 只 trim `ref`，没有限制格式。可以保持这个策略，因为 Git ref 可以是：

- 分支名：`develop`
- 远端分支形式：`origin/develop`
- tag：`v1.2.0`
- commit SHA：`abc123...`

真正不存在的 ref 会在 daemon checkout 时失败，并体现在 task failure 中。

如果希望更早报错，可以加轻量格式校验，但不要在后端禁止合法 Git ref。建议只禁止明显危险或无意义的输入：空白已 trim；可选禁止控制字符和换行。

### 7. 文案

需要更新这些 locale：

- `packages/views/locales/en/modals.json`
- `packages/views/locales/zh-Hans/modals.json`
- `packages/views/locales/ja/modals.json`
- `packages/views/locales/ko/modals.json`
- `packages/views/locales/en/projects.json`
- `packages/views/locales/zh-Hans/projects.json`
- `packages/views/locales/ja/projects.json`
- `packages/views/locales/ko/projects.json`

建议 key：

```json
{
  "repo_ref_label": "分支/ref",
  "repo_ref_placeholder": "main、develop、v1.2.0 或 commit SHA",
  "repo_ref_hint": "留空时使用仓库默认分支。",
  "repo_ref_edit_title": "编辑仓库 ref",
  "repo_ref_save": "保存"
}
```

英文可用：

```json
{
  "repo_ref_label": "Branch/ref",
  "repo_ref_placeholder": "main, develop, v1.2.0, or commit SHA",
  "repo_ref_hint": "Leave empty to use the repository default branch.",
  "repo_ref_edit_title": "Edit repository ref",
  "repo_ref_save": "Save"
}
```

### 8. 测试建议

优先加前端测试，后端已有 schema 支持可少量补充。

建议测试点：

1. `CreateProjectModal` 选择仓库并填写 ref 后，调用 `useCreateProject().mutateAsync` 的 payload 包含：

```json
{
  "resource_type": "github_repo",
  "resource_ref": {
    "url": "...",
    "ref": "develop"
  }
}
```

2. ref 留空时 payload 不包含 `ref`，保持当前行为。

3. `ProjectResourcesSection` 添加 URL + ref 时，调用 `createResource` 的 payload 包含 `ref`。

4. 编辑已有资源清空 ref 时，调用 `updateResource` 的 payload 中 `resource_ref` 不再包含 `ref`。

5. 展示层已有 `repo @ ref` 行为，如果现有测试没有覆盖，补一个渲染测试。

后端可选测试：

- `validateGithubRepoRef` 接收 `{ url, ref }` 并 trim ref。
- `ref` 为纯空白时归一化后不应保留有效值。

### 9. 上线和兼容性

这项定制不需要数据库迁移，因为 `project_resource.resource_ref` 是 JSONB，后端已支持 `ref`。

兼容性影响：

- 老资源没有 `ref`，继续使用远端默认分支。
- 新资源有 `ref`，只有后续新 task 受影响。
- 正在运行的 task 不会被切换 base。
- Desktop 老版本如果不展示 ref，仍可读取资源；真正执行在 daemon 侧，已有 `Ref` 支持。

风险点：

- 用户填了不存在的分支，创建项目可以成功，但 task checkout 会失败。可以接受，也可以后续增强为 daemon 预校验。
- GitLab 私有仓库仍要求 daemon 机器具备 clone 权限；UI 支持 ref 不解决认证问题。
- 如果填 commit SHA，agent 分支会从该 commit 开始；后续 merge/cherry-pick 要人工判断是否适合目标分支。

## 推荐实施顺序

1. 先改 `CreateProjectModal`，实现新建项目时保存 `{ url, ref }`。
2. 再改 `ProjectResourcesSection`，支持项目创建后添加和编辑 ref。
3. 更新 locale。
4. 补前端测试。
5. 手工验证：创建项目 -> 填 GitLab URL + `develop` -> 创建 issue -> 分配智能体 -> 检查执行记录中的分支和 workdir 起点。

## 进一步增强

后续可以考虑：

- 从 Git provider 拉取分支列表做下拉选择。
- 对已配置 VCS 集成的 GitLab 仓库，创建资源时自动查询默认分支。
- 在 task 详情里显示 base ref：例如 `base: develop -> branch: agent/codex/...`。
- checkout 失败时把“不存在 ref 或无权限访问 ref”作为更明确的 failure reason。
