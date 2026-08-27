# Desktop 客户端打包流程

## 背景

Multica Desktop 的正式打包入口在 `apps/desktop`。实际流程不是直接跑 `electron-builder`，而是先走一层自定义脚本：

- 先用 `electron-vite build` 产出 `out/main`、`out/preload`、`out/renderer`
- 再把 Go CLI 打进 `resources/bin/multica.exe`
- 最后交给 `electron-builder` 生成 Windows / macOS / Linux 安装包

这份文档记录的是当前仓库可复用的标准流程，目标是让以后处理 desktop 打包问题时按同一条路径排查，而不是边试边改。

## 目录

- `apps/desktop/scripts/package.mjs`：正式打包脚本
- `apps/desktop/electron-builder.yml`：electron-builder 配置
- `apps/desktop/vitest.config.ts`：桌面端测试配置
- `apps/desktop/scripts/package.test.mjs`：打包配置回归测试
- `apps/desktop/dist/`：打包输出目录

## 一次完整打包

在仓库根目录执行：

```bash
pnpm -C apps/desktop package -- --win --x64 --publish never
```

常用变体：

```bash
pnpm -C apps/desktop package -- --mac --arm64 --publish never
pnpm -C apps/desktop package -- --linux --x64 --publish never
pnpm -C apps/desktop package -- --all-platforms --publish never
```

脚本会做这些事：

1. 清空 `apps/desktop/dist`
2. 执行 `electron-vite build`
3. 根据当前目标平台和架构，构建对应的 Go CLI
4. 调用 `electron-builder`
5. 生成 `dist/<platform>-<arch>` 或单平台输出

## Windows 打包产物

Windows x64 完成后，常见产物包括：

- `apps/desktop/dist/multica-desktop-<version>-windows-x64.exe`
- `apps/desktop/dist/win-unpacked/Multica.exe`
- `apps/desktop/dist/win-unpacked/resources/app.asar`
- `apps/desktop/dist/latest.yml`

其中 `win-unpacked/resources/app.asar` 是最重要的安装包内容检查点。

## 打包前要检查的东西

### 1. 源目录是否干净

打包前先确认没有被误写的文件，尤其是仓库根目录和 `apps/desktop` 根目录下的临时文件。

重点看：

- 根 `package.json` 是否还是合法 JSON
- `apps/desktop` 下是否有本地 `*.log`
- `apps/desktop/dist` 是否是上一次打包的残留

### 2. `apps/desktop/electron-builder.yml`

当前配置里最关键的是 `files:`：

- 必须排除 `dist/**`
- 必须排除本地 `*.log`

原因是：

- `dist/**` 里会有上一次打包生成的安装包和解包目录，继续被打进来会污染下一次产物
- 本地 `*.log` 如果在打包时仍然增长，ASAR 的文件偏移会错位，可能把 `package.json` 或入口文件读坏

## 产物验证

打完包后，至少检查这三件事：

1. `app.asar` 里 `package.json` 是合法 JSON
2. `out/main/index.js`、`out/preload/index.js`、`out/renderer/index.html` 都能读到
3. `app.asar` 里没有把本地调试日志打进去

可以用下面的方式抽检：

```bash
node - <<'NODE'
const path = require('node:path');
const asar = require('G:/Macrowing/multica/multica/node_modules/.pnpm/@electron+asar@3.4.1/node_modules/@electron/asar');
const archive = 'G:/Macrowing/multica/multica/apps/desktop/dist/win-unpacked/resources/app.asar';
for (const parts of [
  ['package.json'],
  ['out', 'main', 'index.js'],
  ['out', 'preload', 'index.js'],
  ['out', 'renderer', 'index.html'],
]) {
  const file = path.join(...parts);
  const content = asar.extractFile(archive, file).toString();
  console.log(file, content.length);
}
NODE
```

如果 `package.json` 抽出来后不是合法 JSON，或者 `out/*` 找不到，说明安装包有问题，不要继续发布。

## 本次踩过的坑

### 1. 本地日志进入 ASAR

这次遇到的核心问题是：`apps/desktop` 目录下有本地调试日志文件，`electron-builder` 在打包时把它们一起收进了 ASAR。因为日志文件是持续写入的，最终导致 ASAR 里的文件偏移错位，`package.json` 内容被污染，安装后的桌面客户端启动无反应。

修复方式已经写入 `apps/desktop/electron-builder.yml`：

```yaml
  - "!*.log"
```

### 2. `asar extract-file` 的行为

`asar extract-file` 不会把文件内容打印到标准输出，而是把文件解出来写到当前目录，文件名就是目标文件名的 basename。排查 ASAR 时更适合直接用 `@electron/asar` 的 API 读取，而不是只靠 CLI 输出。

### 3. 读取 ASAR 时注意 Windows 路径

在 Windows 下，`@electron/asar` 的路径需要用 `path.join('out', 'main', 'index.js')` 这类真实分隔符，不要手工拼字符串。手写 `/` 或转义反斜杠都容易误判成“文件不存在”。

## 推荐排查顺序

以后 desktop 打包异常，优先按这个顺序看：

1. `apps/desktop/package.json`、`apps/desktop/electron-builder.yml` 是否被误改
2. `apps/desktop/dist/` 和 `apps/desktop` 根目录是否有残留日志、旧安装包、旧解包目录
3. `apps/desktop/scripts/package.mjs` 是否真的完成了 `electron-vite build`
4. 新生成的 `app.asar` 里 `package.json` 和 `out/*` 是否完整
5. 再看安装包本身是否能启动

## 验证命令

```bash
pnpm -C apps/desktop exec vitest run scripts/package.test.mjs
pnpm -C apps/desktop package -- --win --x64 --publish never
```

如果只是检查产物完整性，也可以直接看：

```bash
node - <<'NODE'
const path = require('node:path');
const asar = require('G:/Macrowing/multica/multica/node_modules/.pnpm/@electron+asar@3.4.1/node_modules/@electron/asar');
const archive = 'G:/Macrowing/multica/multica/apps/desktop/dist/win-unpacked/resources/app.asar';
for (const parts of [
  ['package.json'],
  ['out', 'main', 'index.js'],
  ['out', 'preload', 'index.js'],
  ['out', 'renderer', 'index.html'],
]) {
  const file = path.join(...parts);
  const content = asar.extractFile(archive, file).toString();
  console.log(file, content.length);
}
NODE
```

## 当前结论

当前 desktop 打包流程已经恢复可用，最新 Windows 包已成功生成。以后遇到“安装后无反应”，优先先看 ASAR 内容是否被错误文件污染，再看主进程日志和窗口启动逻辑。
