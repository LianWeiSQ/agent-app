---
id: "agent-visual-evidence-index"
title: "配图和试验记录的来源与检查"
type: "index"
tags: ["agent", "infra", "evidence"]
sources: ["src-feishu-interview", "src-feishu-project-story", "src-feishu-agent-infra", "src-harbor-samples"]
confidence: "inferred"
status: "reference"
updated: "2026-10-08"
---

# 配图和试验记录的来源与检查

三个图均为重新绘制的 workflow 说明图，不是产品运行截图。它们支持架构讲解，不证明相关能力全部上线。JSON 是可编辑规格，HTML 下载后可交互阅读，PNG 用于正文预览。

| 图 | 正文入口 | 可编辑规格 | 交互文件 |
| --- | --- | --- | --- |
| 任务到文件成果 | [项目总览](../projects/README.md) | [JSON](task-delivery.json) | [HTML](task-delivery.html) |
| 沙箱申请到回收 | [沙箱创建](../../infra/sandbox/01-创建预热与就绪.md) | [JSON](../../infra/assets/sandbox-lifecycle.json) | [HTML](../../infra/assets/sandbox-lifecycle.html) |
| 评测推动改动 | [Harbor 专题](../07-Harbor评测与持续改进.md) | [JSON](evaluation-loop.json) | [HTML](evaluation-loop.html) |

## 检查记录

三个图的确定性校验均为 9/9 showcase，0 errors、0 warnings。浏览器检查覆盖 1440×900、1600×1000、1920×1080、2048×1320，均无页面溢出。另逐图查看了大尺寸浅色与小尺寸深色截图，未发现节点、标签或连线遮挡。两轮规格修正后冻结交付，未改动通过校验的 HTML。

检查只针对图本身。规格与 HTML 的 SHA-256、图片摘要和检查状态保存在 [Agent 产物清单](manifest.json)及 [Infra 产物清单](../../infra/assets/manifest.json)。每次改图需要重新生成、核对并更新摘要；浏览器通过不等于技术结论已验证。

## 真正的运行证据

[Harbor 历史样本摘要](../evidence/harbor-samples.json)来自实际本地结果文件，核对范围见[来源页](../sources/Harbor样本核对.md)。它是两次历史试验的有限摘录，不是平台规模和性能收益证明。

产品实图仍待逐图确认公开范围，优先补同一任务的输入、过程与成果。不得用模拟页面或生成图片代替这些证据。
