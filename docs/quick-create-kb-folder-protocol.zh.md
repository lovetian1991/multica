# Quick-create 与手动创建的知识库文件夹协议

本文说明产品版本和知识库文件夹选择在两种创建模式中的保存、传递和读取方式。

## 1. 两种创建模式

| 模式 | 请求 | 最终写入 | 执行者 |
| --- | --- | --- | --- |
| 手动创建 | `POST /api/issues` | `issue.product_id`、`issue.product_version_id`、`issue.kb_folder_id` | 当前用户 |
| 快速创建 | `POST /api/issues/quick-create` | `agent_task_queue.context` JSONB | daemon 上的智能体 |

两种模式共用创建弹窗和 `TaskProductFolderPicker`。手动创建会立即保存 issue；快速创建先保存任务上下文，再由智能体执行 `multica issue create`。

## 2. 手动创建保存位置

手动创建请求可以携带：

```json
{
  "product_id": "<product-uuid>",
  "product_version_id": "<version-uuid>",
  "kb_folder_id": "12998"
}
```

数据库字段：

```text
表：issue
列：product_id          UUID（已有）
列：product_version_id  UUID（已有）
列：kb_folder_id        TEXT（迁移 458_issue_kb_folder_id）
```

`kb_folder_id` 不建立外键，因为它属于外部知识库服务。后端会校验 `product_version_id` 存在且属于 `product_id`，并对 folder ID 做首尾空格清理。更新时发送 `null` 或空字符串可以清空 folder。

相关代码：

- 请求和响应：[issue.go](/G:/Macrowing/multica/multica/server/internal/handler/issue.go)
- 业务参数：[issue.go](/G:/Macrowing/multica/multica/server/internal/service/issue.go)
- SQL：[issue.sql](/G:/Macrowing/multica/multica/server/pkg/db/queries/issue.sql)
- 迁移：`server/migrations/458_issue_kb_folder_id.up.sql`

## 3. 快速创建保存位置

快速创建请求：

```json
{
  "agent_id": "<agent-uuid>",
  "prompt": "...",
  "product_id": "<product-uuid>",
  "kb_folder_id": "12998"
}
```

后端把 folder ID 写入：

```go
QuickCreateContext.KBFolderID
```

并序列化到：

```text
表：agent_task_queue
列：context
类型：JSONB
路径：context ->> 'kb_folder_id'
```

该 `context` 列由 `server/migrations/003_task_context.up.sql` 添加。它不是 `agent_task_queue` 的独立列。

查询示例：

```sql
SELECT id, status, context->>'kb_folder_id' AS kb_folder_id
FROM agent_task_queue
WHERE context->>'type' = 'quick_create'
ORDER BY created_at DESC;
```

## 4. daemon 和智能体获取

claim 时服务端返回：

```json
{
  "quick_create_product_id": "<product-uuid>",
  "quick_create_kb_folder_id": "12998"
}
```

daemon 内部字段：

```text
Task.QuickCreateKBFolderID
execenv.TaskContextForEnv.QuickCreateKBFolderID
```

quick-create 提示词会明确写出：

```text
knowledge-base-folder: required for this run. Use folder ID "12998".
```

## 5. 任务环境变量

daemon 启动智能体 CLI 时，会注入：

```text
MULTICA_SERVER_URL=<当前 Multica 服务地址>
MULTICA_TOKEN=mat_<当前任务令牌>
MULTICA_WORKSPACE_ID=<workspace-uuid>
MULTICA_AGENT_ID=<agent-uuid>
MULTICA_AGENT_NAME=<agent-name>
MULTICA_TASK_ID=<task-uuid>
MULTICA_TASK_CONFIG_ROOT=<task-private-config-dir>
MULTICA_TASK_WORKSPACES_ROOT=<daemon-workspaces-root>
MULTICA_DAEMON_PORT=<local-daemon-port>
MULTICA_TASK_SLOT=<daemon-slot>
OPENCONTENT_APIKEY=<workspace-oc-key>
```

快速创建选择了 folder 时，还会注入：

```text
MULTICA_QUICK_CREATE_TASK_ID=<task-uuid>
MULTICA_KB_FOLDER_ID=12998
```

规则：

- 只在 folder ID 非空时注入 `MULTICA_KB_FOLDER_ID`。
- 普通 issue、chat、autopilot 任务不注入该变量。
- `custom_env` 不能覆盖任何 `MULTICA_*` 变量或 `OPENCONTENT_APIKEY`。
- `MULTICA_TOKEN` 是当前 `(agent, task)` 的临时令牌，不能当作长期凭据使用。

`OPENCONTENT_APIKEY` 来自 workspace 的 `oc_key`，供 OpenContent skill 通过 Multica facade 使用。系统设置中的 `MULTICA_OPENCONTENT_URL`、KB 环境地址和加密集成 key 只在服务端使用，不会直接注入任务环境。

## 6. skill 如何读取

skill 的 `SKILL.md` 和 supporting files 是静态文件，daemon 会按运行时写入原生目录，例如：

```text
Claude   .claude/skills/<name>/SKILL.md
Codex    CODEX_HOME/skills/<name>/SKILL.md
OpenCode .opencode/skills/<name>/SKILL.md
Qwen     .qwen/skills/<name>/SKILL.md
```

动态 folder ID 不写入静态 skill 文件。skill 脚本通过任务子进程环境读取：

```ts
const folderId = process.env.MULTICA_KB_FOLDER_ID;
```

智能体本身还可以从 quick-create 提示词读取同一个 ID。skill 需要自行约定何时调用脚本，并使用这个 ID；它不会收到名为 `kb_folder_id` 的函数参数。

## 7. 获取 folder 内容

服务端 folder wrapper：

```http
GET /api/system/kb/folders?folder_id=12998&page_index=1
```

调用链：

```text
skill 脚本 / CLI / MCP tool
  -> Multica facade
  -> server/internal/handler/kb_folder.go
  -> 服务端读取系统设置 KB URL + 加密集成 key
  -> OpenContent 上游
```

daemon 目前只传递 folder ID，不会自动获取子文件夹，也不会把 folder 内容写入 skill 文件。要读取内容，skill 必须通过可用的 CLI 或 MCP tool 发起请求。

## 8. 排查

手动创建：

```sql
SELECT id, product_id, product_version_id, kb_folder_id
FROM issue
WHERE id = '<issue-uuid>';
```

快速创建：

```sql
SELECT id, status, context->>'kb_folder_id'
FROM agent_task_queue
WHERE id = '<task-uuid>';
```

执行环境中检查：

```text
MULTICA_SERVER_URL
OPENCONTENT_APIKEY
MULTICA_KB_FOLDER_ID
```

对应代码位置：

- 前端请求：[create-issue.tsx](/G:/Macrowing/multica/multica/packages/views/modals/create-issue.tsx)、[quick-create-issue.tsx](/G:/Macrowing/multica/multica/packages/views/modals/quick-create-issue.tsx)
- 环境注入：[daemon.go](/G:/Macrowing/multica/multica/server/internal/daemon/daemon.go)
- 环境回归测试：`server/internal/daemon/daemon_test.go`
