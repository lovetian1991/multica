# Desktop 自托管服务器登录地址配置方案

## 背景

当前 Multica Desktop 的运行时服务地址由 `~/.multica/desktop.json` 决定。打包客户端启动时读取该文件；文件不存在时使用官方云端默认值：

```json
{
  "schemaVersion": 1,
  "apiUrl": "https://api.multica.ai",
  "wsUrl": "wss://api.multica.ai/ws",
  "appUrl": "https://multica.ai"
}
```

Desktop 登录页本身不承载完整 OAuth 流程。用户点击 Google 登录时，Desktop 打开系统浏览器访问 `${appUrl}/login?platform=desktop`；Web 登录完成后通过 `multica://auth/callback?token=...` deep link 把 token 交回 Desktop。Desktop 再用 `apiUrl` 请求 `/api/me` 验证 token，并把 token 写入本地存储。

这意味着自托管登录至少涉及两个地址：

| 地址 | 用途 |
| --- | --- |
| `appUrl` | Web 前端地址，浏览器打开登录页和 OAuth callback。 |
| `apiUrl` | 后端 API 地址，Desktop renderer 直接请求 `/api/*`、`/auth/*`、`/v1/*`、`/uploads/*`、`/ws`。 |

在 Kubernetes NodePort 部署中，这两个地址可能不同。例如当前验证到的部署：

```text
http://192.168.11.173:30080  -> frontend service，NodePort 到 frontend pod:3000
http://192.168.11.173:30081  -> backend service，NodePort 到 backend pod:8080
```

同时 `30080` 前端设置了：

```text
REMOTE_API_URL=http://multica-backend:8080
```

所以 `http://192.168.11.173:30080/api/config` 会由 Next middleware 转发到后端，并返回与 `http://192.168.11.173:30081/api/config` 相同的 JSON。根路径表现仍然不同：`30080/` 返回 Web 页面，`30081/` 返回 404 是正常的后端行为。

## 目标

让用户首次打开 Desktop 登录页时可以输入自托管实例地址。确认后 Desktop 自动写入 `~/.multica/desktop.json`，并使用该地址完成后续认证。

同时，第二次打开 Desktop 登录页时应自动显示上一次保存的地址，让用户明确当前客户端连接的是哪个实例。

注意：如果 Desktop 已经持有有效登录态，启动后会直接进入主界面，不会经过登录页。因此“登录页显示上一次保存地址”只覆盖未登录、登录过期、退出登录后的场景。已登录用户查看或切换服务器需要主界面内的独立入口。

## 非目标

- 不改服务器端登录协议。
- 不新增 Desktop 专属 OAuth callback 服务器。
- 不改变现有 `multica://auth/callback?token=...` deep link 语义。
- 不要求用户理解 `apiUrl`、`appUrl`、`daemon_server_url` 的差异后才能登录。
- 首版不支持已登录状态下无感热切换服务器；切换服务器必须显式退出当前实例并重新登录。

## 推荐用户体验

Desktop 登录页新增一个登录前的服务器选择区。

首次启动：

1. 如果 `~/.multica/desktop.json` 不存在，默认显示官方云端，或显示空输入框加“使用 Multica Cloud”入口。
2. 用户输入自托管 Web 地址，例如：

```text
http://192.168.11.173:30080
```

3. 用户点击“继续”。
4. Desktop 请求 `${输入地址}/api/config`。
5. 如果返回 JSON 且包含自托管地址信息，自动生成运行时配置并保存。
6. 重载 renderer，让 `CoreProvider` 使用新的 `apiUrl/wsUrl/appUrl` 初始化。
7. 登录页显示已确认的服务器地址，并允许用户继续邮箱验证码或 Google 登录。

第二次启动：

1. Desktop 读取 `~/.multica/desktop.json`。
2. 如果没有有效登录态，登录页展示上次保存的地址，例如：

```text
服务器：http://192.168.11.173:30080
```

3. 用户可以直接登录，也可以进入“更改服务器”重新输入地址。

已登录启动：

1. Desktop 读取 `~/.multica/desktop.json`。
2. `CoreProvider` 用该配置初始化 API client 和 WebSocket。
3. 如果本地 `multica_token` 仍有效，认证初始化会请求 `/api/me` 并直接进入 Desktop 主界面。
4. 登录页不会渲染，因此用户不会在启动路径上看到服务器输入框。

主界面应提供只读服务器标识，例如在 Settings 中显示：

```text
当前服务器
Web: http://192.168.11.173:30080
API: http://192.168.11.173:30081
```

如果已登录用户点击“切换服务器”，应进入显式确认流程：说明会退出当前实例、停止或清理当前 daemon token、清空本地登录态，然后重载到登录页的服务器选择状态。

## 地址解析规则

推荐把用户输入解释为“Web/App URL”，而不是直接解释为 `apiUrl`。

原因：

- 用户通常知道自己在浏览器打开的地址。
- Desktop 的 Google 登录必须打开 Web 前端。
- Web 前端可以通过 `/api/config` 暴露推荐的 daemon/API 地址。
- 自托管部署可能使用 `30080` 作为 Web 入口、`30081` 作为后端直连入口。

解析流程：

1. 规范化输入 URL：只接受 `http:` 或 `https:`，去掉 query/hash，去掉末尾 `/`。
2. 请求 `${webUrl}/api/config`。
3. 如果响应成功，读取：

```json
{
  "daemon_server_url": "http://192.168.11.173:30081",
  "daemon_app_url": "http://192.168.11.173:30080"
}
```

4. 生成 Desktop runtime config：

```json
{
  "schemaVersion": 1,
  "apiUrl": "http://192.168.11.173:30081",
  "appUrl": "http://192.168.11.173:30080"
}
```

5. 如果 `daemon_server_url` 为空，则回退为：

```json
{
  "schemaVersion": 1,
  "apiUrl": "<用户输入的 webUrl>",
  "appUrl": "<用户输入的 webUrl>"
}
```

该回退支持“前端统一入口完整代理后端路径”的部署。

`wsUrl` 默认不写入，由现有 `deriveWsUrl(apiUrl)` 推导。

## 当前部署示例

用户输入：

```text
http://192.168.11.173:30080
```

Desktop 探测：

```text
GET http://192.168.11.173:30080/api/config
```

返回：

```json
{
  "daemon_server_url": "http://192.168.11.173:30081",
  "daemon_app_url": "http://192.168.11.173:30080"
}
```

写入 `~/.multica/desktop.json`：

```json
{
  "schemaVersion": 1,
  "apiUrl": "http://192.168.11.173:30081",
  "appUrl": "http://192.168.11.173:30080"
}
```

后续行为：

- Desktop API 请求走 `http://192.168.11.173:30081`。
- Desktop Google 登录打开 `http://192.168.11.173:30080/login?platform=desktop`。
- Web callback 通过 `multica://auth/callback?token=...` 回到 Desktop。
- Desktop 用 `http://192.168.11.173:30081/api/me` 验证 token。

## 技术方案

### 1. 主进程新增 runtime config 保存 IPC

位置：

- `apps/desktop/src/main/runtime-config-loader.ts`
- `apps/desktop/src/main/index.ts`
- `apps/desktop/src/preload/index.ts`
- `apps/desktop/src/preload/index.d.ts`

新增能力：

```ts
runtimeConfig: RuntimeConfigResult;
saveRuntimeConfig(input: {
  apiUrl: string;
  appUrl?: string;
  wsUrl?: string;
}): Promise<RuntimeConfigResult>;
resetRuntimeConfig(): Promise<RuntimeConfigResult>;
```

保存逻辑必须在主进程完成：

1. 用现有 `parseRuntimeConfig` 规则校验并规范化地址。
2. 写入 `desktopConfigPath()`，也就是 `~/.multica/desktop.json`。
3. 更新主进程内存中的 `runtimeConfigResult`。
4. 返回规范化后的配置或错误。

文件写入需要创建 `~/.multica` 目录。

### 2. renderer 新增服务器探测 helper

建议放在 Desktop renderer 平台层：

- `apps/desktop/src/renderer/src/platform/server-discovery.ts`

职责：

```ts
export async function discoverDesktopRuntimeConfig(inputUrl: string): Promise<{
  apiUrl: string;
  appUrl: string;
  wsUrl?: string;
}>;
```

规则：

1. 输入视为 Web URL。
2. 请求 `${webUrl}/api/config`。
3. 使用 zod 或本地窄 schema 解析公开字段：
   - `daemon_server_url?: string`
   - `daemon_app_url?: string`
4. 优先使用 `daemon_server_url` 作为 `apiUrl`。
5. 优先使用 `daemon_app_url` 作为 `appUrl`。
6. 缺失时回退到输入 URL。
7. 对生成结果再次调用主进程 `saveRuntimeConfig` 校验。

注意：不要直接依赖 `@multica/core/api` 的全局 `api` 实例做探测，因为它已经绑定当前 runtime config。探测应使用原生 `fetch` 和输入 URL。

### 3. Desktop 登录页加入服务器选择 UI

位置：

- `apps/desktop/src/renderer/src/pages/login.tsx`
- 可拆出 `apps/desktop/src/renderer/src/components/server-endpoint-form.tsx`

登录页显示逻辑：

- 如果 runtime config 正常，显示当前服务器。
- 如果当前配置来自默认云端，显示 Multica Cloud，并允许切换到自托管。
- 如果读取到了上一次保存的自托管地址，直接显示该地址。
- 用户点击“更改服务器”后显示输入框。

文案建议：

```text
服务器
http://192.168.11.173:30080

更改服务器
继续
使用 Multica Cloud
```

错误状态：

- 地址不是有效 HTTP/HTTPS URL。
- `${url}/api/config` 无法访问。
- 返回不是 JSON。
- 返回的 `daemon_server_url` 或 `daemon_app_url` 不是有效 HTTP/HTTPS URL。
- 保存 `desktop.json` 失败。

### 4. 保存后重载 renderer

当前 `CoreProvider` 在模块级 singleton 中只初始化一次：

- API client
- auth store
- chat store
- WebSocket provider
- config store

因此不建议在同一个 renderer 生命周期内热切换 `apiUrl`。

推荐保存配置成功后执行：

```ts
window.location.reload();
```

重载前应清理跨服务器状态：

- `localStorage.removeItem("multica_token")`
- 清空 workspace/tab 相关 Desktop store
- 通知 daemon 清理当前 token，避免旧服务器 token 被新服务器复用

如果只允许未登录状态下更改服务器，清理范围可以更小，但仍建议删除 `multica_token`。

### 5. 登录流程保持现状

保存并 reload 后，`CoreProvider` 用新的 `apiUrl/wsUrl` 初始化。

后续登录保持当前链路：

1. 邮箱验证码：Desktop 直接请求新 `apiUrl` 的 `/auth/send-code` 和 `/auth/verify-code`。
2. Google 登录：Desktop 打开 `${appUrl}/login?platform=desktop`。
3. Web 登录完成后 deep link 回 Desktop。
4. Desktop 调用 `loginWithToken()`，向新 `apiUrl` 的 `/api/me` 验证 token。

### 6. 已登录状态的服务器展示与切换

首版应把已登录状态下的能力限定为“展示当前服务器”和“退出并切换服务器”。不要在主界面内热切换 `apiUrl`。

建议位置：

- Settings → Account 或 Settings → Advanced
- Help / About popover 中可只读展示当前服务器

展示值应优先面向用户显示 `appUrl`，同时在展开详情中显示 `apiUrl`：

```text
服务器：http://192.168.11.173:30080
API：http://192.168.11.173:30081
```

“切换服务器”流程：

1. 弹出确认：切换服务器会退出当前账号，并清理本机 daemon 凭据。
2. 用户确认后执行现有 logout 清理路径。
3. 额外调用 `window.daemonAPI.clearToken()` 和 `window.daemonAPI.stop()`，确保当前实例的 daemon 不继续使用旧 token。
4. 打开服务器选择状态，或写入新配置后 `window.location.reload()`。
5. reload 后因为 `multica_token` 已清理，Desktop 会进入登录页。

这样可以保持当前 `CoreProvider` 单次初始化模型，也避免一个已登录 session 在不同自托管实例之间泄漏 token、workspace cache 或 tab state。

## 与 CLI 配置的关系

CLI 的 `multica setup self-host` 中：

```powershell
multica setup self-host `
  --server-url http://192.168.11.173:30081 `
  --app-url http://192.168.11.173:30080
```

含义是：

| CLI 字段 | Desktop 对应字段 | 当前示例 |
| --- | --- | --- |
| `server_url` | `apiUrl` | `http://192.168.11.173:30081` |
| `app_url` | `appUrl` | `http://192.168.11.173:30080` |

Desktop 自动探测应尽量生成与 CLI setup 等价的配置。这样 Desktop renderer、Desktop 管理的 daemon profile、独立 CLI profile 都会指向同一组服务地址。

## 边界情况

### 统一入口部署

如果用户输入的地址本身完整代理后端路径，且 `/api/config` 没有返回 `daemon_server_url`，可以写入：

```json
{
  "schemaVersion": 1,
  "apiUrl": "https://multica.example.com",
  "appUrl": "https://multica.example.com"
}
```

### 后端直连地址输入

如果用户直接输入后端地址，例如：

```text
http://192.168.11.173:30081
```

`/api/config` 也会返回 JSON。若 JSON 里包含 `daemon_app_url`，仍可得到正确配置：

```json
{
  "schemaVersion": 1,
  "apiUrl": "http://192.168.11.173:30081",
  "appUrl": "http://192.168.11.173:30080"
}
```

如果没有 `daemon_app_url`，应提示用户补充 Web 地址，而不是盲目把后端地址当成 `appUrl`，否则 Google 登录会打开后端地址的 `/login` 并失败。

### 官方云端

“使用 Multica Cloud”应写入默认配置或删除 `desktop.json`。删除文件更接近现有行为，但写入默认配置能让登录页明确显示当前选择。两者都可行，推荐写入默认配置并提供重置说明。

### 切换服务器

切换服务器时必须清理旧认证状态。旧 token 即使格式有效，也属于另一个后端签发，不能带到新实例。

### HTTP 自托管

局域网自托管可使用 `http://`。如果后续浏览器 OAuth 或 cookie 策略要求 HTTPS，应由 Web/后端配置层明确报错；Desktop 地址保存层只需接受 HTTP/HTTPS。

## 测试计划

### 单元测试

新增或更新：

- `apps/desktop/src/shared/runtime-config.test.ts`
  - 保持 `apiUrl/appUrl/wsUrl` normalize 规则。
  - 覆盖只有 `apiUrl` 时推导 `appUrl/wsUrl`。

- `apps/desktop/src/main/runtime-config-loader.test.ts`
  - 缺少 `desktop.json` 使用默认配置。
  - 无效 JSON 返回阻塞错误。
  - 保存有效配置后可重新读取。
  - 保存无效 URL 返回错误且不覆盖旧文件。

- `apps/desktop/src/renderer/src/platform/server-discovery.test.ts`
  - `daemon_server_url + daemon_app_url` 都存在时分别映射到 `apiUrl/appUrl`。
  - 字段缺失时回退到输入 URL。
  - 后端直连输入但缺少 `daemon_app_url` 时要求补充 Web URL。
  - 非 JSON、网络失败、非法 URL 都给出可展示错误。

- `apps/desktop/src/renderer/src/pages/login.test.tsx` 或组件测试
  - 第二次打开显示上次保存地址。
  - 点击更改服务器后可输入新地址。
  - 保存成功后触发 reload。
  - 保存失败保留在当前页面并显示错误。

- 已登录服务器展示/切换入口测试
  - 有有效 `multica_token` 时启动直接进入 Desktop 主界面，不渲染登录页服务器输入框。
  - Settings 中显示当前 `appUrl` 和 `apiUrl`。
  - 已登录切换服务器必须先确认退出。
  - 确认后清理 token、daemon token、tab/workspace 状态，并重载到未登录服务器选择流程。

### 手动验证

使用当前服务器：

```text
Web URL: http://192.168.11.173:30080
API URL: http://192.168.11.173:30081
```

验证步骤：

1. 删除或备份 `~/.multica/desktop.json`。
1. 启动 Desktop。
1. 输入 `http://192.168.11.173:30080`。
1. 确认写入：

```json
{
  "schemaVersion": 1,
  "apiUrl": "http://192.168.11.173:30081",
  "appUrl": "http://192.168.11.173:30080"
}
```

1. 重启或 reload 后登录页显示 `http://192.168.11.173:30080`。
1. 邮箱验证码登录能请求到自托管后端。
1. Google 登录能打开 `http://192.168.11.173:30080/login?platform=desktop`。
1. 登录成功后 Desktop 能获取 workspace 列表。
1. Desktop managed daemon profile 的 `server_url` 指向 `http://192.168.11.173:30081`。
1. 关闭并重新打开 Desktop；如果 token 有效，应直接进入主界面。
1. 在主界面 Settings 中确认当前服务器展示为 `30080`，详情中的 API 地址为 `30081`。
1. 从 Settings 触发切换服务器，确认退出后应回到未登录服务器选择流程。

## 推荐落地顺序

1. 先实现主进程保存配置 IPC 和测试。
2. 再实现 renderer 服务器探测 helper 和测试。
3. 最后改 Desktop 登录页 UI。
4. 在 Settings 中增加已登录状态的服务器展示。
5. 增加“退出并切换服务器”流程。
6. 手动验证当前 NodePort 部署。
7. 再考虑是否支持更复杂的登录后服务器管理。

首版只支持未登录状态下选择服务器，以及已登录状态下“退出并切换服务器”。不做无感热切换，范围最小，也能避免跨工作区、跨服务器状态迁移问题。
