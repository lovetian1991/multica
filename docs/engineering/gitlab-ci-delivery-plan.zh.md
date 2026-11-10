# GitLab CI 进度与部署地址接入计划

更新日期：2026-11-10。状态：首版本地代码与模板已实现，尚未发布，尚未同步到已安装小队，真实 GitLab 联调待令牌与项目样本。

## 小队交付闭环路线图

```text
拿到 PRD
  -> 一次技术设计（原功能目录 / 技术设计）
  -> 开发、自测
  -> 一次独立最终验证
  -> 按授权 commit + push
  -> 原任务登记项目配置、完整 SHA、实际远端 ref
  -> 结束本轮模型运行
  -> Multica 后端跟踪该提交的 GitLab CI / 指定部署 Job
  -> 原任务展示流水线、Job、访问地址，并写一条终态结果
  -> 用户打开环境验收
       通过：在原任务记录验收结论，按既有流程关闭任务 / Bug
       不通过：记录具体问题，明确指派修复，再登记修复后的新提交
```

角色边界：技术负责人负责设计与最终交付登记，开发成员实现、自测，独立验证者只做最终验证，后端负责 CI 跟踪，用户负责业务验收。不增加专职 CI 角色，不为等待流水线重复派发小队。Bug 小队按原有串行修复，每轮每仓库以最终 push 的 SHA 汇总。

“开发完成”“部署成功”“验收通过”是三个结论。首版保留原任务状态语义，验收通过采用现有评论和任务操作；**尚未实现独立验收状态、验收按钮或自动关闭规则**。CI 失败不自动重跑小队；“恢复跟踪”只重新读取已绑定流水线，不点击 GitLab 重试或部署按钮。

### 启用顺序

1. 完成数据库集成与端到端验证后，发布后端、Web/桌面、CLI 及 617–620 迁移；目前未执行线上更新。
2. 用户在工作区设置的 GitLab 连接中配置 API 令牌，不在聊天中发送；后台令牌不下发给智能体。
3. 管理员在同页“交付跟踪”配置连接、数字项目 ID、精确部署 Job 名、流水线 source、地址主机白名单、日志标记与等待上限。
4. 部署 Job 真正完成后输出独立行 `MULTICA_DEPLOY_URL=https://app.example.com/path`。首版只解析该方式，不猜测日志里的普通 URL。
5. 同步内置平台技能及开发 / Bug 小队模板到已安装小队；在运行中的任务结束后安排，不重导入或中断当前运行。
6. 用一个真实测试环境提交验证：正确提交关联、CI 状态、地址回传、人工验收和失败处理，再推广到其他仓库。

### 当前实现与待办

| 已实现的本地能力 | 尚未完成 / 后续能力 |
| --- | --- |
| 加密连接复用、管理员项目规则、登记 API / CLI / 界面 | 真实令牌和目标实例版本、网络、权限验证 |
| 数据库存储交付及规则快照；后端约 30 秒检查，单批最多 10 条 | 项目级预算、429 Retry-After / 指数退避、Webhook 加速 |
| SHA + ref + source 精确匹配并绑定 pipeline ID；Job 分页及重试过滤 | 多候选人工选择、下游 / 子流水线、合并后 SHA 显式关联 |
| 成功流水线与指定 Job 的日志标记提取、主机白名单、敏感链接限制 | GitLab Environment / 结构化制品来源、环境版本与健康检查 |
| 原任务交付面板、一次终态系统评论、显式恢复跟踪 | 多仓库整体完成判定、独立验收状态 / 按钮 |
| 开发 / Bug 中英文模板及内置技能登记指令 | 线上发布、CLI 升级、已安装小队同步 |

本地验证记录见文末。下文保留调研与后续设计；未列入“已实现”的能力不代表当前可用。

## 1. 结论与范围

可以通过工作区配置的 GitLab API 访问令牌，跟踪指定提交的流水线、Job 状态，并读取部署 Job 的控制台日志，提取最终访问地址。前提是令牌所属账号有目标项目及相关日志、制品的读取权限。

配置令牌是授权，不等于平台已经具备持续跟踪能力。当前对话也不是常驻监控服务；应由 Multica 后端执行跟踪，不依赖智能体运行时一直在线。

目标流程：

```text
技术设计 -> 开发和自测 -> commit + push
                              |
                     登记本次提交到当前任务
                              |
                     仓库已有 GitLab CI 自动运行
                              |
                   Multica 后台跟踪流水线与部署 Job
                              |
                 当前任务展示进度、结果、日志链接、访问地址
```

本期不新增审批阶段、不转交其他小队、不另建 CI、不重复触发已有流水线，不自动执行人工部署按钮或生产发布。不让模型循环读取流水线，也不默认启动自动修复循环。

## 2. 已确认的现状

### 代码基础

| 位置 | 现有能力 | 本次缺口 |
| --- | --- | --- |
| `packages/views/settings/components/code-vcs.tsx` | 工作区设置中的 GitLab 实例地址、访问令牌、Webhook 信息 | 按仓库配置需要跟踪的部署 Job 和地址来源 |
| `server/internal/handler/vcs.go` | 校验 API 令牌；加密保存令牌和 Webhook 密钥 | 检查目标项目、流水线、日志的实际读取权限 |
| `server/internal/integrations/vcs/gitlab.go` | MR 和 Pipeline Webhook；规范化 CI 状态 | 项目/流水线 ID、ref、source、Job、部署信息尚未进入交付跟踪 |
| `server/internal/handler/vcs_webhook.go` | 镜像 CI 状态，通过已关联 MR 的 head SHA 找任务 | 直接 push 无 MR 时，没有可靠的提交到任务关联 |
| `server/pkg/db/queries/vcs.sql` | 按 connection + SHA + context 保存粗粒度状态 | 同一 SHA 多条流水线会合并，不足以表达一次准确的交付 |
| `server/internal/scheduler/manager.go` | 数据库支持的后台调度与执行记录 | 增加范围受控的交付跟踪作业 |

原 GitLab Webhook 适配器只处理 MR/Pipeline 事件。本次新增独立的 `gitlab_delivery.go` 只读客户端，不复用粗粒度 CI 结果判断部署完成；交付跟踪保留 `skipped`、`manual` 等区别。

模板仓库 `multica-best-practices` 中：

- `templates/zh_CN/squad/development/squad.md` 已采用技术设计后直接开发、一次验证的流程，不应重新增加 CI/CD 阶段流转。
- `templates/zh_CN/squad/bug-fix/squad.md` 要求同轮 Bug 共用分支、按 Bug 串行处理；不应每修一条都阻塞等待完整部署。
- 旧 `multica-artifact-cicd-sync` 是偏 Jenkins 主动触发的流程，不用于本次被动跟踪，也不恢复已删除的旧技能。

### 只读环境检查

- 当前工作区 VCS 接口返回 `available=true`、`configured=true`、`can_manage=true`，连接数量为 0。
- 本机访问 GitLab `http://172.16.0.83/users/sign_in` 返回 HTTP 200。
- 尚未验证 Multica 后端 Pod 到 GitLab API、GitLab 到 Multica Webhook 的网络连通性。
- 尚未获得目标 GitLab 版本、项目 ID、真实流水线及部署日志样本；不能宣称已完成端到端接入。

以上检查未更改线上配置，也未重启或调整运行中的小队。

## 3. 凭据与项目配置

复用现有“工作区设置 -> 代码 -> 自托管 Git -> GitLab”连接，不新增第二套令牌存储。

建议采用专用服务账号的 PAT，或目标实例支持的项目/群组访问令牌，先只授予 `read_api`。仍需确认账号的项目成员角色、流水线可见性和制品访问限制；scope 正确不代表一定能读取所有日志。

SSH 私钥、Git deploy key、只有 `read_repository` 的令牌，不能代替这项 API 授权。运行时用于 clone/push 的 Git 凭据和后台用于读取 CI 的令牌是两套用途；后台令牌不下发给小队或写入提示词。

每个要跟踪的仓库增加以下配置：

| 配置 | 含义 |
| --- | --- |
| `connection_id` + `project_id` | GitLab 连接及数字项目 ID；由 API 确认，不能只用仓库短名 |
| `ref` / pipeline source 策略 | ref 在登记时提交；配置 source，默认 `push` |
| 部署 Job 名称 | 首版精确指定一个部署任务，不支持同名矩阵任务或下游部署 |
| 地址来源 | 首版为指定成功 Job 的独立日志标记；Environment / 制品待后续 |
| 地址主机范围 | 可回传的环境域名/IP 范围，防止拿到镜像仓库或依赖文档地址 |
| 等待上限 | 区分没有流水线、执行超时和等待人工操作 |

连接现有实例时需注意：目前“重新连接同一实例”会同时轮换令牌和 Webhook 密钥，不能把它当成无副作用的令牌更新操作。

GitLab 当前使用 HTTP，API 令牌会以明文经过网络。建议优先提供 HTTPS；确需先在内网接入时，应确认网络隔离和访问范围。私有 CA 应加入后端信任库，不关闭 TLS 验证。

## 4. 准确关联本次交付

push 成功后，小队使用自身的 Multica 身份登记：

```json
{
  "project_config_id": "<workspace delivery project configuration UUID>",
  "sha": "<full commit SHA confirmed pushed to remote>",
  "ref": "<actual remote branch>"
}
```

本地已实现 `POST /api/issues/{id}/deliveries`、`GET /api/issues/{id}/deliveries`、`POST /api/issues/{id}/deliveries/{deliveryId}/resume`。校验工作区、任务访问权和项目配置归属。相同工作区、任务、项目配置、SHA、ref 重复登记返回同一记录；配置及项目身份在登记时快照保存。

配套 CLI（需发布新版本）：

```sh
multica issue delivery projects
multica issue delivery register TANY-20 --project-config-id <config-uuid> --sha <full-sha> --ref <remote-ref>
multica issue delivery list TANY-20
multica issue delivery resume TANY-20 <delivery-id>
```

`projects` 返回不含凭据的 `instance_url`、项目路径和配置 UUID。登记项目必须与实际 push 的远端实例、项目路径匹配，不能猜测配置 ID。小队登记成功就结束本轮模型运行，不循环调用 `list`。

关联规则：

1. 以 GitLab 实例/连接、项目 ID、完整 SHA、ref 查找流水线，再按已配置 source 筛选。找到后绑定具体 pipeline ID。
2. 相同提交有 push、MR、手动或定时流水线时，不取“全项目最新一条”。仍有多条候选时首版停止跟踪并显示歧义，不猜测；人工选择入口待后续。
3. 合并后 SHA 或 merge-train SHA 发生变化时，需要显式登记新交付，不冒用原分支结果；自动解析 MR/合并关系尚未实现。
4. 新 push 建立新交付；旧交付保留历史，晚到的旧事件不能覆盖当前提交的结果。
5. 前后端分别登记各自仓库，同一任务列出各条交付，首版不自动计算整体成功。
6. 如果真正部署发生在下游项目或子流水线，首版不支持；需要样本后沿明确触发关系扩展，不能在上游测试结束时宣称已部署。

## 5. 服务端跟踪

采用一个数据库持久化的跟踪作业，复用已有 scheduler，不引入新的消息队列或让每个任务常驻一个智能体。

- 首版约 30 秒调度一次，只查询已登记、到期的交付，单批最多 10 条、单次检查最多 8 秒；不扫描所有仓库。项目级预算和限流退避尚未实现，先小范围启用。
- 首版不依赖 Webhook；后续可扩展事件解析以加速同一个跟踪作业，不建立第二套状态机。
- 后台重启后从数据库恢复未完成记录；以原始状态和流水线/Job ID 处理重试及重复事件。
- 普通进度只更新交付记录和界面，不发评论、不启动模型。每轮跟踪终态最多写一条结果评论，与通知标记同事务提交。显式恢复后可再写一条新结果，原评论保留。
- 失败评论不自动 @ 整个小队，不修改会导致任务重新派发的原始评论；是否启动修复由用户明确决定。

下面是后续完整状态维度的设计。首版保存跟踪 `status`，以及 `result` 中的 GitLab pipeline/job 原始状态、链接、地址来源和原因；尚无 superseded 状态及独立部署/地址枚举：

| 维度 | 示例 |
| --- | --- |
| 跟踪状态 | 等待流水线、跟踪中、等待人工、已结束、同步异常、已被新提交替代 |
| GitLab 原始状态 | `pending`、`running`、`manual`、`success`、`failed`、`canceled`、`skipped` 等 |
| 部署结果 | 未配置部署、未部署、部署中、部署成功、部署失败 |
| 地址结果 | 未获取、已获取、缺失、多个候选、读取受限 |

首版 `manual` 保留 Job / Pipeline 链接，以固定频率检查；达到等待上限后停止自动请求、保留恢复入口。401/403 停止为权限阻塞，网络错误和 429 显示同步重试，不冒充 CI 失败。人工等待降频与 429 按响应头退避属于后续工作。

流水线通过、部署 Job 成功、服务可访问、业务验收通过是不同结论。首版不自动探测日志里任意 URL；如后续需要健康检查，应限定地址范围并校验当前部署版本。

## 6. 最终访问地址的获取

### 后续选项：GitLab Environment（未实现）

读取与本次成功部署匹配的 deployment/job，再取关联环境的 `external_url`。核对 SHA、pipeline ID、job ID 和环境名，不能仅查询同名环境的“最新一次部署”。

共享环境的 URL 可能固定，但版本会被后续部署覆盖。界面保留本次部署的提交和时间；如果环境当前已被其他提交覆盖，应明确提示，不能继续宣称该地址仍在运行本次代码。

### 后续选项：指定部署 Job 的结构化制品（未实现）

如仓库愿意做一个很小的改造，部署脚本可以输出 `deployment.json`，包含 URL、SHA、环境名；通过精确 job ID 下载，不用“分支最新成功 Job”接口代替。

另一种标准做法是用 dotenv 报告把动态 URL 传给 `environment:url`，最终仍通过 GitLab Environment 读取。dotenv 报告不应包含密码，也不能假设所有 report 文件都能直接作为普通制品下载。

### 首版已实现：部署 Job 控制台日志

首版读取精确 Job 的日志：

```text
GET /api/v4/projects/:project_id/jobs/:job_id/trace
```

由后台读取配置的部署 Job 日志，要求最终输出明确的独立行（可配置标记）：

```text
MULTICA_DEPLOY_URL=https://<actual-deployed-host>/<path>
```

解析约束：

- 仅解析本次流水线中指定部署 Job 的有效执行结果；Job 重试时不能读旧 attempt 的地址。
- 去除 ANSI 控制字符，限制读取量和解析时间；超限显示无法提取，不把截断结果当作完整日志。
- 对 URL 协议和配置的主机范围做校验；多个冲突地址标记歧义，不采用“整个日志最后一个 URL”。
- 日志中的凭据、登录票据和带敏感参数的链接不回传。只保存必要结果、来源 job ID 和简短脱敏证据，不把整份日志放进模型上下文或任务评论。
- 日志被清理、权限不足或没有匹配地址时，显示具体原因和 Job 链接。部署成功但没有地址，就标记地址缺失，不编造地址。
- 控制台输出只是数据，不作为智能体指令执行。

首版不支持对任意既有日志格式自动猜测。若真实流水线无法提供独立标记，需先给脱敏样本确认改造方式，不能直接宣称已经接入。

## 7. 界面、数据与小队改动

### 平台

- 工作区连接下配置仓库级跟踪规则，提供只读的连接/权限检查。
- 任务详情增加紧凑的交付记录：仓库、分支、短 SHA、流水线及部署状态、最后同步时间、GitLab 链接、访问地址及其来源。
- 独立保存交付记录，至少包括任务/工作区、连接/项目、SHA/ref、pipeline/job ID、原始状态、部署和地址结果、更新时间、下次检查时间及错误类别。
- 不把现有 `vcs_commit_status` 粗粒度 PR 检查记录强行改成交付模型，保持 MR 展示及旧客户端 API 兼容。
- 沿用 `server/`、`packages/core/`、`packages/views/` 的职责划分；新增 API 同步 schema 和异常响应测试，Web/Desktop 共用视图。首版不扩展独立移动端界面。
- migration 不增加外键或级联，索引单独使用 concurrent migration；断开连接后停止该连接的跟踪，并处理关联配置与历史记录中的敏感数据。

### 开发与 Bug 小队

- 共用本次新增的 `multica issue delivery` 命令，不让每个角色各自编写 GitLab 客户端或携带 GitLab 令牌。
- 开发小队：push 后登记本次提交并返回跟踪链接，不再派“查 CI”“收集部署地址”的独立成员。
- Bug 小队：保持现有串行修复方式，每轮每仓库最终 push 后登记，不为每条 Bug 等一次完整部署。新的 SHA 是新交付，不覆盖旧记录。
- 保留现有开发完成与禅道已解决语义，另行展示交付结果；不因 CI 通过关闭 Bug，也不因等待部署重跑已完成开发。
- 当前 MR 合并可能自动变更任务状态；本期不全局改写这一行为。即使任务进入 `done`，已登记的交付仍独立跟踪，`done` 不自动等于“已上线”。
- 模板与已安装小队分开更新，先验证模板，再安排同步；不重导入、取消或打断正在执行的运行。

## 8. 分阶段实施

| 阶段 | 工作 | 完成条件 |
| --- | --- | --- |
| P0：一个仓库只读验证 | 配置连接，确认版本和网络，读取一条成功/失败流水线、部署 Job、日志或环境地址 | 准确关联实际 SHA/pipeline/job，确认最小权限和一种地址来源 |
| P1：最小端到端闭环 | 本地代码与模板已实现；数据库、真实流水线、发布与已安装小队同步待验证 | 一次真实 push 后自动看到进度和对应部署地址，不新增模型轮询和小队流转 |
| P2：按真实需求补齐 | 开通 Webhook 加速；需要时支持下游部署、多仓库汇总和其他地址来源 | 基于真实样本验收，不把未使用场景作为 P1 前置条件 |

如果 P0 确认真正部署发生在下游流水线，则该路径进入 P1，不能用上游成功替代交付验收。实际工期在 P0 拿到样本后估算，当前不承诺未经验证的天数。

发布时按工作区/项目显式启用；出现问题可关闭新跟踪，不影响原有 Git push、GitLab CI 和 MR 集成。

## 9. 验收清单

- [ ] 没有 MR，直接 push 也能绑定正确任务与完整 SHA。
- [ ] 同项目其他人提交、同 SHA 多条流水线均不会串结果。
- [ ] Job 分页、重试、允许失败任务，以及旧 Webhook 晚到不会导致错误终态。
- [ ] `manual`、`skipped`、取消、没有 CI、权限不足都与部署成功明确区分。
- [ ] 从一条真实部署日志提取正确地址；歧义、无地址、日志被清理不猜测。
- [ ] 若使用 Environment，确认对应本次 deployment；共享环境被覆盖时不误导用户。
- [ ] 后端重启后继续跟踪；运行时离线不影响已登记的流水线。
- [ ] 普通进度没有模型调用、没有评论刷屏、没有自动派发。
- [ ] 令牌不进入日志、响应、仓库、模型上下文；成员只能访问其工作区内允许查看的交付信息。
- [ ] 用脱敏日志测试解析与泄密防护；接口覆盖鉴权/隔离/异常响应；通过已有 MR CI 展示回归测试。

## 10. 需要用户提供的最小材料

1. 在当前工作区设置连接 GitLab，使用有目标项目读取权限的 API 令牌。不要在聊天中发送令牌或私钥。
2. 一个要接入的 GitLab 项目链接；若已知，附项目 ID 和 GitLab 版本。
3. 一条已完成流水线链接、真正部署的 Job 链接，以及打印访问地址的几行脱敏日志。
4. `.gitlab-ci.yml`、相关 include/部署脚本的脱敏片段，尤其是部署 Job 的名称、分支规则和 `environment` 配置。
5. 确认目标是测试/预发/生产中的哪个环境，是否存在人工确认、下游项目或 CI 之外的异步部署平台。

先给第 1-3 项即可开展 P0；后两项用于避免把“构建成功”误判为“部署完成”。后台双向网络及 GitLab 内网 Webhook 限制由部署方检查，不要求用户在聊天中提供服务器密码。

## 11. 调研依据

本地依据见第 2 节源码和 `apps/docs/content/docs/vcs-integration.zh.mdx`。

GitLab 官方文档通过官方代码镜像 `gitlabhq/gitlabhq` 的 `doc/` 原文读取，核实了 pipeline 查询、Job trace、按 Job 下载制品、Environment URL、动态 dotenv URL 和 token scope。查询到的镜像 master 标识为 `d7b9a6176ab4e279465ba3ee09922cde2b74de47`；文档不是用户实例的版本声明。

来源地址：

```text
https://github.com/gitlabhq/gitlabhq/blob/d7b9a6176ab4e279465ba3ee09922cde2b74de47/doc/api/pipelines.md
https://github.com/gitlabhq/gitlabhq/blob/d7b9a6176ab4e279465ba3ee09922cde2b74de47/doc/api/jobs.md
https://github.com/gitlabhq/gitlabhq/blob/d7b9a6176ab4e279465ba3ee09922cde2b74de47/doc/api/job_artifacts.md
https://github.com/gitlabhq/gitlabhq/blob/d7b9a6176ab4e279465ba3ee09922cde2b74de47/doc/api/deployments.md
https://github.com/gitlabhq/gitlabhq/blob/d7b9a6176ab4e279465ba3ee09922cde2b74de47/doc/api/environments.md
https://github.com/gitlabhq/gitlabhq/blob/d7b9a6176ab4e279465ba3ee09922cde2b74de47/doc/ci/environments/_index.md
https://github.com/gitlabhq/gitlabhq/blob/d7b9a6176ab4e279465ba3ee09922cde2b74de47/doc/security/tokens/access_token_scopes.md
```

实施时先读取目标 GitLab 版本并验证真实响应。例如文档标注 GitLab 19.2 起下游触发查询使用 `trigger_jobs`、旧 `bridges` 路由被弃用；目标实例版本未确认前，不假定任一路由或新版事件字段必然存在。

## 12. 本地验证与发布边界

2026-11-10：

- GitLab 集成客户端包测试通过，覆盖精准流水线、分页 Job、人工状态、允许失败、独立日志标记、地址歧义与敏感链接限制、错误脱敏。
- 新增 CLI 定向测试 `go test ./cmd/multica -run TestIssueDeliveryCLI -count=1` 通过。
- 核心 API 异常响应与登记测试 6 项通过；交付面板、设置及原任务详情回归 4 个文件共 123 项通过。
- core / views TypeScript 类型检查、涉及的新前端文件 ESLint 已通过。
- handler / scheduler / server 可编译。handler 和 server 的测试入口因数据库不可连接跳过，**不是数据库集成测试通过**；迁移及事务通知仍需真实数据库验证。
- 扩大执行整个 CLI 包有失败，涉及既有 Windows 路径、临时目录转义和 daemon 测试进程断言；本次没有修改这些无关实现，也不声明全量测试通过。
- 按仓库托管脚本尝试启动开发环境，因 Docker daemon 未运行而失败；API、Web、daemon、desktop 均未启动，因此未完成浏览器视觉检查和真实端到端 push 验证。
- 未配置用户 GitLab 令牌，未执行 GitLab 写操作、线上发布、数据库迁移、CLI 安装替换或已安装小队同步。
