---
id: "infra-index"
title: "Infra：模型和执行环境怎样运行"
type: "index"
tags: ["infra","inference","sandbox"]
sources: ["src-infra-session"]
confidence: "inferred"
status: "reference"
updated: "2026-10-08"
---

# Infra

沿着一条 Agent 任务往下看：调用模型的请求会进入推理服务，执行代码的请求会进入沙箱；两种负载可以同时存在，但生命周期和资源需求不同。

| 章节 | 要回答的问题 |
| --- | --- |
| [01 一次推理请求](01-一次推理请求.md) | Prefill、Decode、KV Cache、批处理、排队和路由怎样连起来？ |
| [02 vLLM 单实例](02-vLLM单实例.md) | API、调度、GPU Worker 与显存分别负责什么？ |
| [03 GPU 与模型部署](03-GPU与模型部署.md) | Pod、GPU、Rank、模型实例和副本是不是一回事？ |
| [04 路由与 P/D 分离](04-路由与PD分离.md) | 怎样选实例，什么时候值得分离计算阶段？ |
| [05 沙箱与执行资源](05-沙箱与执行资源.md) | 环境、预热、执行、文件和回收怎样衔接？ |
| [06 容器与隔离](06-容器运行时与隔离.md) | Docker、K8s、CRI、containerd、runc 怎么分层？ |
| [07 容量与排障](07-容量压测与故障定位.md) | 慢在哪里，容量怎样测，故障怎样归因？ |
| [08 学习与实操](08-学习路线与实验记录.md) | 从 Transformers 到服务化、压测和训练的最小路径 |

[会话摘要](sources/会话摘要.md)保留哪些是教学示例、哪些仍待实践；[公开参考](sources/公开参考.md)提供官方资料入口。

这一部分目前是学习与设计总结，不能据此声称本人已运营多卡推理、物理 P/D 分离或大规模 GPU 集群。资源侧恢复要结合 [Agent 任务状态](../agent/03-持久状态与故障恢复.md)一起理解。
