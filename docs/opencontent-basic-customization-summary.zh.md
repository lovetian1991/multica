# OpenContent 基础能力定制结果汇总

## 定制目标

本次定制将原有 OpenContent skill 收敛为 `oc-basic`，只保留基础文件和目录能力；同时在 Multica 服务端增加一个独立的 OpenContent 固定接口 facade，为需要通过 Multica 网络访问 OpenContent 的调用方提供受控转发能力。

当前统一使用 Multica 转发链路：

- `oc-basic` 配置 `MULTICA_SERVER_URL` 指向 Multica API 地址。
- skill 将固定 OpenContent 操作映射到 Multica 的 `/api/opencontent/{operation}`。
- Multica 服务端再使用 `MULTICA_OPENCONTENT_URL` 访问 OpenContent 上游。
- `OPENCONTENT_APIKEY` 只配置在 skill 运行环境中；skill 获取 OpenContent RSA 公钥后，将 API Key 加密为 Bearer 密文再逐请求转发。

## Skill 保留命令

| 命令 | 能力 |
| --- | --- |
| `file-list` | 浏览文件夹直接子项 |
| `file-info` | 查询文件信息 |
| `folder-info` | 查询文件夹信息 |
| `upload` | 上传单个或多个文件 |
| `download` | 下载文件、文件夹或 PDF 转换结果 |
| `create-folder` | 新建文件夹 |
| `user-info` | 查询当前用户信息 |

已移除搜索、元数据、标签、共享、团队、权限、收藏、协作库、知识库、轻文档和其他高级操作。`.NET` 实现也已移除。

## Skill 认证

Skill 配置 Multica 服务地址和 OpenContent API Key：

```dotenv
MULTICA_SERVER_URL=http://localhost:8080
OPENCONTENT_APIKEY=your-api-key
```

请求使用：

```http
Authorization: Bearer <RSA-encrypted-OPENCONTENT_APIKEY>
```

skill 先通过 `/api/opencontent/auth-public-key` 获取 OpenContent RSA 公钥，再使用公钥加密 API Key。Multica 只转发 RSA Bearer 密文，不在服务端保存或解密 API Key。不支持传统账号密码认证，不配置 OpenContent session token 或 `checkToken`。

## CLI 边界

- CLI 只注册 7 个固定命令。
- 删除了 `oc POST /path` 等任意 API 透传入口。
- 内部 `callApi` 仅作为业务代码的通用 HTTP 封装，不是用户可调用的 CLI 能力。
- 请求目标仍由业务模块固定指定，不从用户输入拼接任意上游路径。

## Multica 服务端模块

新增模块目录：

```text
server/internal/opencontent/
├── config.go
├── client.go
├── upload.go
├── config_test.go
├── client_test.go
└── upload_test.go
```

Handler 位于：

```text
server/internal/handler/opencontent.go
```

路由注册在：

```text
server/cmd/server/router.go
```

## 服务端固定转发

facade 只支持基础操作对应的固定 operation，包括目录列表、文件信息、文件夹信息、新建文件夹、用户信息、个人库目录、上传检查、分片上传、下载检查、转档状态和实际下载。

客户端只能选择 operation，不能传入任意目标 URL。服务端会过滤 Host、Cookie、Multica 身份头和 hop-by-hop header，只转发必要请求头，其中包含调用方提供的 OpenContent Bearer。

## 上传安全策略

默认允许：

```text
.md, .txt, .pdf, .png, .jpg, .jpeg, .gif, .webp
```

默认限制：

- 上传请求体：20 MiB
- 上游响应体：64 MiB
- 上游超时：35 秒

上传会检查 multipart 格式、后缀、空文件和实际内容类型。分片上传只对首片执行完整内容 sniff，后续分片检查非空和声明的总大小。

## 文档位置说明

`opencontent-skill/node/deploy/` 下的脚本是 skill 发布工具，负责构建 release、打包并上传/审核 skill 包，不是 Multica 服务器配置文档。本次服务器配置和定制结果分别记录在：

- `docs/opencontent-facade-server-config.zh.md`
- `docs/opencontent-basic-customization-summary.zh.md`

## 验证结果

已完成：

- Skill TypeScript 类型检查通过。
- Skill 单元测试通过：6 个测试文件，37 个测试。
- Skill CLI 构建通过。
- Multica Monorepo lint 通过，仅有既有 warnings。
- Multica Monorepo build 完成，仅有既有构建 warnings。
- `git diff --check` 通过。

未完成：

- 当前执行环境没有 Go 编译器，因此尚未运行 `go test`、`go vet` 或 `gofmt`。
- Multica 全量前端测试存在一个与本次改动无关的既有失败：`apps/web/app/type-scale.test.ts` 中的字体尺寸约束测试。
