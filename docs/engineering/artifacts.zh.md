# 运行产物规范

所有测试、E2E、性能测试、验证脚本和排查过程产生的文件，一律写到仓库根目录下的
`artifacts/`，不要散落在仓库根目录、包目录或随手新建的临时文件夹里。

`artifacts/` 已在 `.gitignore` 中整体忽略，不进版本库；确认无用后可以整目录删除，
不影响代码。

## 目录结构

```
artifacts/
  <功能或任务>/          # 一级目录按功能、任务号或场景命名
    ...
```

一级目录用**功能名**或**任务标识**，不要用日期或人名：

| 场景 | 目录 |
| --- | --- |
| 工单相关验证 | `artifacts/work-order/` |
| 某张任务单的验证过程 | `artifacts/TANY-23/` |
| 常规 E2E | `artifacts/e2e/` |
| 性能测试 | `artifacts/perf/` |
| 单次排查、复现脚本 | `artifacts/<问题简述>/` |

同一个功能多次运行的产物放在同一目录下，由运行工具自己按用例或时间再分子目录；
不要每次运行新建一个顶层目录。

## 硬性要求

- 任何脚本、测试、工具**默认输出路径**都指向 `artifacts/`，不要默认写到仓库根目录。
- 截图、日志、trace、录屏、导出的 JSON/CSV、临时 clone、生成的中转文件，全部属于产物。
- 需要长期保留、要进版本库的内容（设计文档、规范、基线数据）放 `docs/` 或代码目录，
  **不要**放 `artifacts/`。
- 已经存在的分散输出目录（如 `test-results/`、`playwright-report/`）保持忽略状态，
  新代码不要再往这些位置写。

## 清理

```bash
rm -rf artifacts/            # 全部清理
rm -rf artifacts/<功能>       # 只清理某个功能
```

Windows 上同理，直接删目录即可。仓库不做自动清理，由使用者在目录变大时手动处理。

## 当前已接入的位置

- Playwright 主配置：用例产物 `artifacts/e2e/`，HTML 报告 `artifacts/e2e/report/`
- Playwright 性能配置：`artifacts/perf/`
- Playwright iframe 局部配置：`artifacts/e2e-iframe/`
