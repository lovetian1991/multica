# CLI 打包分发流程

## 背景

官方安装脚本（`scripts/install.sh` / `scripts/install.ps1`）从 GitHub Releases 下载产物，内网机器通常够不着；而且同事装完之后还要自己跑一次 `multica setup`，填服务器地址、登录、启动 daemon。

这套脚本把分发压缩成「给一个 zip」：

- 打包机跑 `scripts/package-cli.sh`，产出**自包含 zip**：平台二进制 + 安装脚本
- 同事拿到 zip，解压后跑一条命令，安装 / 配置服务器 / 登录 / 启动 daemon 一次完成

## 目录

- `scripts/package-cli.sh`：交叉编译各平台，产出 zip 和 `checksums.txt`
- `scripts/install-local.ps1`：Windows 安装脚本，会被打进 zip 并改名为 `install.ps1`
- `scripts/install-local.sh`：macOS/Linux 安装脚本，打进 zip 后叫 `install.sh`
- `dist-cli/`：打包输出目录（已在 `.gitignore` 中）

打包脚本不变动这两个安装脚本的内容，只是把它们原样复制进 zip，所以改安装逻辑只需要改 `scripts/` 下的源文件。

## 一次完整打包

在仓库根目录执行：

```bash
bash scripts/package-cli.sh --os windows --arch amd64
```

默认打全部平台（`windows,linux,darwin` × `amd64,arm64`），只给 Windows 用就按上面这样收窄。

常用变体：

```bash
# 全部平台
bash scripts/package-cli.sh

# 指定版本号
bash scripts/package-cli.sh --version 0.0.0-dev-6ec7c29d8

# 换输出目录
bash scripts/package-cli.sh --os windows --arch amd64 --out /tmp/mirror
```

脚本会做这些事：

1. 清空输出目录（默认 `dist-cli/`）
2. 对每个 平台/架构 组合执行 `CGO_ENABLED=0 go build`，注入 `main.version` / `main.commit` / `main.date` 三个 ldflags
3. 把对应平台的安装脚本复制进产物目录
4. 打成 zip，并校验 zip 根目录确实有二进制和安装脚本
5. 生成 `checksums.txt`

版本号默认取自 `git describe`，只在 HEAD 正好落在 tag 上时才用 tag，否则用 `0.0.0-dev`。这个默认值是有意的，原因见下方「注意事项」。

## 产物

```bash
dist-cli/
  multica-windows-amd64.zip      # multica.exe + install.ps1
  multica-linux-amd64.zip        # multica + install.sh
  multica-darwin-arm64.zip       # multica + install.sh
  ...
  checksums.txt
```

Windows 包里是 `install.ps1`，其他平台是 `install.sh`，都在 zip 根目录。

## 分发给同事

只需要把对应平台的 zip 给出去（IM、邮件、共享盘都行），同事两步：

**Windows**

```powershell
# 解压后，在解压目录里执行
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

**macOS / Linux**

```bash
# 解压后，在解压目录里执行
sh ./install.sh
```

## 安装脚本的行为

以 Windows 为例，执行后依次是：

1. 找到与自己同目录的 `multica.exe`（若解压时多套了一层文件夹，也会往下一层找），复制到 `%USERPROFILE%\.multica\bin\`
2. 把该目录写进用户 PATH
3. 打印内置的服务器地址和 token 申请页地址，提示输入 access token
4. 按输入分两条路：
   - **粘了 token** → `multica config set server_url/app_url` + `multica login --token <token>`，全程不弹浏览器
   - **直接回车** → 同样先写配置，再用 `multica login` 走浏览器流程（Linux 下调 `xdg-open`；无图形界面或 SSH 场景，CLI 会打印一个登录 URL 让你在别的机器的浏览器里打开）
5. `multica daemon stop`（忽略失败）→ `multica daemon start`
6. 打印摘要；如果登录失败，摘要末尾会额外警告这台机器还不能跑 agent

第 3 步的提示长这样：

```text
  Access tokens are created under Settings > API Tokens:
    http://<app_url>/settings?tab=tokens

  Paste a token to sign in without a browser,
  or press Enter to sign in through your browser.

  Access token (optional):
```

macOS/Linux 版本逻辑相同，只是安装目录为 `/usr/local/bin`，不可写时退回 `~/.local/bin`，并把目录写进 `~/.bashrc` / `~/.zshrc`。

如果目标机器**已经配置过**同一个 server，脚本会问一句是否重新配置，直接回车就保留原配置（包括原 token），不会覆盖。

**非交互环境**（计划任务、CI）下不会卡在输入提示上：脚本检测到 stdin 不是终端时，自动退回浏览器登录，或者用 `MULTICA_TOKEN` 直接跳过输入。这一点用 `[Environment]::UserInteractive` 判断是不可靠的——它在没有控制台的进程里照样返回 `True`，所以 PowerShell 版用的是 `[Console]::IsInputRedirected`，bash 版用的是 `[ -t 0 ]`。

## 内置服务器地址

换服务器时只需要改每个安装脚本顶部的那两个常量。Windows 版在 `scripts/install-local.ps1`：

```powershell
$DefaultServerUrl = "http://192.168.11.173:30081"
$DefaultAppUrl    = "http://192.168.11.173:30080"
```

macOS/Linux 版在 `scripts/install-local.sh`：

```bash
DEFAULT_SERVER_URL="http://192.168.11.173:30081"
DEFAULT_APP_URL="http://192.168.11.173:30080"
```

token 申请页地址由 app URL 推导，不用单独配。

改完要**重新打包**，因为安装脚本是在打包时复制进 zip 的。

## 环境变量

安装时可用环境变量覆盖默认行为：

| 变量 | 作用 |
| --- | --- |
| `MULTICA_TOKEN` | 直接用这个 token 登录，跳过输入提示 |
| `MULTICA_SERVER_URL` | 覆盖内置的 server URL |
| `MULTICA_APP_URL` | 覆盖内置的 app URL |
| `MULTICA_BIN_DIR` | 安装目录（Windows 默认 `%USERPROFILE%\.multica\bin`；macOS/Linux 默认 `/usr/local/bin`） |
| `MULTICA_SKIP_PATH_UPDATE=1` | 不修改 PATH |
| `MULTICA_SKIP_SETUP=1` | 只装二进制，跳过配置 / 登录 / daemon |

打包时可用环境变量：

打包脚本要求 `go` 在 PATH 上，缺失时会在开头直接报错退出。

## 常见场景

**只给 Windows x64 一台机器装**

```bash
bash scripts/package-cli.sh --os windows --arch amd64
```

然后直接把 `dist-cli/multica-windows-amd64.zip` 发过去。

**批量无人值守安装**

把 token 通过环境变量传进去，安装过程不再需要任何交互：

```powershell
$env:MULTICA_TOKEN="mul_xxxx"
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

**升级已安装的机器**

直接重跑安装脚本即可：二进制会被替换，配置保留（回车跳过重新配置），daemon 会被停掉再拉起。

**只装二进制，先不配置**

```powershell
$env:MULTICA_SKIP_SETUP="1"
powershell -ExecutionPolicy Bypass -File .\install.ps1
```

之后手动跑 `multica setup self-host --server-url ... --app-url ...`。

## 注意事项

**版本号会影响 daemon 的自动更新。** daemon 只在自身版本号形如 `x.y.z` 时才会去 GitHub 轮询新版本（见 `server/internal/cli/update.go` 的 `IsReleaseVersion`）。所以：

- 默认的 `0.0.0-dev` 不会被官方 release 覆盖，适合自定义分发
- 如果显式传 `--version 0.4.43` 这种纯三段数字，而目标机器又能访问 GitHub，daemon 会把这个包升级成官方版本

另外，连接自建服务器时 daemon 的 GitHub 拉取默认就是关闭的（self-host 场景默认 off），但要留意用户手动执行 `multica update` 仍会去访问 GitHub。

**token 不能预置进分发包。** PAT 是每人一个的凭据，且 `~/.multica/config.json` 里是明文存储，所以同事那边必然要有一次登录动作（粘 token 或走浏览器）。

**升级会打断正在执行的任务。** 安装脚本会先 `multica daemon stop` 再 `start`，如果这台机器上正跑着长任务，升级时机需要自己把握。

**`checksums.txt` 是给人手工校验用的**，安装脚本不读它。要核对就把 zip 的 SHA256 和文件里的值比一下。

**打包机需要 Go 工具链在 PATH 上。** 交叉编译不需要目标平台机器，在 Windows 上就能打出 macOS / Linux 的包。

**Windows 上打包要留意文件权限。** Git Bash 的 `chmod` 在 NTFS 上不生效，zip 也不携带可执行位，所以 macOS/Linux 的安装脚本用 `install -m 0755` 显式设权限，而不是依赖解压出来的属性。

**`.sh` 必须保持 LF 行尾。** 带 `\r` 的 shell 脚本在 Linux 上会直接报错，仓库 `.gitattributes` 已用 `*.sh text eol=lf` 兜住。
