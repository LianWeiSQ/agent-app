---
id: "src-harbor-samples"
title: "来源：两份 Harbor 本地历史结果核对"
type: "source"
tags: ["agent", "evaluation", "evidence"]
sources: []
confidence: "verified"
status: "reference"
updated: "2026-10-08"
evidence: ["../evidence/harbor-samples.json"]
---

# 两份 Harbor 本地历史结果核对

2026-10-08 读取了两份原始结果 JSON，以及成功样本的 verifier 标准输出。公开证据为[字段白名单提取](../evidence/harbor-samples.json)，包含原文件 SHA-256，不包含运行标识、服务器、凭据、原始轨迹和完整配置。

verified 仅指下列字段与本地已有记录核对一致，不代表重新运行了任务、第三方认证了成绩，或确认了产品生产能力。

| 项目 | OpenSSL 任务 | fix-git 任务 |
| --- | --- | --- |
| 运行日期，UTC | 2026-09-09 | 2026-09-10 |
| 环境 | Docker | Docker |
| 结果 | reward 1.0；verifier 日志 6 项通过 | NetworkConnectionError；无执行与判分结果 |
| 可支持的结论 | 该次安装、执行、收集与验证链路跑通 | 该次试验未进入可判分的任务执行 |
| 不支持的结论 | 整个任务集通过率、模型排名、远端沙箱接入成功 | 模型不会完成 Git 任务 |

成功样本记录的 Harness 是 deepseek-harness，版本 0.1.2-rc.1；模型名称是记录中的 gpt-5.6-sol。Harness 名称不是模型身份，不能把它写成 DeepSeek 模型成绩。

总时长约 362 秒，Agent 准备约 170 秒，执行约 178 秒；根据各阶段时间戳计算并四舍五入，剩余时间属于其他环节。一次样本只能帮助说明阶段耗时，不能推导 P95 或优化百分比。

verifier 环境记录为 shared。独立判分逻辑不等于已证明验证环境不可被候选 Agent 影响。该项安全结论需另做隔离和防篡改测试。

两份样本不是随机抽样，也不是完整试验分母，不能把一成功一失败换算成平台成功率。
