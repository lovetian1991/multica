# OpenContent 基础接口服务器配置

## 适用范围

Multica 服务端提供一个可选的 OpenContent 固定接口 facade，供 `oc-basic` skill 或内部集成使用。`oc-basic` 将请求发送到 Multica 的 facade，Multica 服务端再转发到 OpenContent 上游。

## 配置项

在 Multica API 服务端的环境变量中配置：

```dotenv
MULTICA_OPENCONTENT_ENABLED=true
MULTICA_OPENCONTENT_URL=https://opencontent.example.com
MULTICA_OPENCONTENT_TIMEOUT=35s
MULTICA_OPENCONTENT_MAX_UPLOAD_BYTES=20971520
MULTICA_OPENCONTENT_MAX_RESPONSE_BYTES=67108864
MULTICA_OPENCONTENT_UPLOAD_EXTENSIONS=md,txt,pdf,png,jpg,jpeg,gif,webp
```

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `MULTICA_OPENCONTENT_ENABLED` | `false` | 是否启用 facade，默认关闭 |
| `MULTICA_OPENCONTENT_URL` | 空 | OpenContent 上游绝对地址，只允许 `http` 或 `https` |
| `MULTICA_OPENCONTENT_TIMEOUT` | `35s` | 上游请求超时时间 |
| `MULTICA_OPENCONTENT_MAX_UPLOAD_BYTES` | `20971520` | 上传请求体上限，默认 20 MiB |
| `MULTICA_OPENCONTENT_MAX_RESPONSE_BYTES` | `67108864` | 上游响应体上限，默认 64 MiB |
| `MULTICA_OPENCONTENT_UPLOAD_EXTENSIONS` | `md,txt,pdf,png,jpg,jpeg,gif,webp` | 上传后缀白名单，逗号分隔 |

服务端不配置、不保存 OpenContent API Key。调用方必须先通过 `auth-public-key` 获取 OpenContent RSA 公钥，再在业务请求中携带 RSA 加密后的 Bearer：

```http
Authorization: Bearer <RSA-encrypted-OPENCONTENT_APIKEY>
```

该 RSA Bearer 密文只在当前请求转发到 OpenContent 上游，不写入数据库、服务端配置或日志。

## 固定接口

路由格式：

```text
/api/opencontent/{operation}
```

允许的 operation 及上游路径如下：

| operation | 方法 | 固定上游路径 |
| --- | --- | --- |
| `auth-public-key` | GET | `/inbiz/auth/api/Auth/GetLoginRsaPublicKey` |
| `file-list` | POST | `/FlatDms/v800/Document/DocList/GetFolderChildren` |
| `file-info` | GET | `/flatsdk/api/services/DocList/GetFileByIdOrGuid` |
| `folder-info` | POST | `/flatsdk/api/services/DocList/GetFolderByGuidOrId` |
| `create-folder` | POST | `/flatsdk/api/services/TemplateCreate/CreateFolder` |
| `user-info` | POST | `/flatsdk/api/services/User/GetUserInfoByToken` |
| `personal-folder` | POST | `/flatsdk/api/services/User/GetTopPersonalFolderId` |
| `upload-check` | POST | `/FlatDms/V800/Transport/Upload/CheckAndCreateDocInfo` |
| `upload` | POST | `/document/upload` |
| `upload-multi` | POST | `/document/uploadMultiTd` |
| `download-check` | POST | `/FlatDms/V800/Transport/Download/DownloadCheck` |
| `download-status` | POST | `/FlatDms/V800/Transport/Download/GetFormatConvertStatus` |
| `download` | GET | `/downLoad/index` |

`auth-public-key` 仅用于获取 OpenContent RSA 公钥，不要求 Bearer；其它 operation 必须携带 API Key RSA 密文 Bearer。未知 operation、错误 HTTP 方法和任意路径不会转发。

## 上传安全

上传请求会在转发前执行以下检查：

- 整个 multipart 请求体不得超过 `MULTICA_OPENCONTENT_MAX_UPLOAD_BYTES`。
- 文件后缀必须在白名单内。
- 不允许空文件。
- `.pdf`、图片等类型会根据文件内容进行 MIME 检查，不信任客户端声明的 part MIME。
- 分片上传首片执行完整内容检查，后续分片只检查文件名后缀、非空和声明总大小。
- 查询参数中拒绝 `token`、`checkToken`、`apikey`、`authorization` 和 `password`，凭据只能放在 Bearer header 中。

## 启动行为

- 未设置 `MULTICA_OPENCONTENT_ENABLED=true` 时，接口返回 `503`。
- 开启后缺少或错误配置 `MULTICA_OPENCONTENT_URL` 时，服务端记录配置错误并禁用该集成。
- 上游连接失败返回 `502`。
- 上传超过大小限制返回 `413`。
- 上传后缀、内容或 multipart 格式不符合要求返回 `400`。

修改配置后需要重启 API 服务。
