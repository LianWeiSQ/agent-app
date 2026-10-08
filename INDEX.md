# 知识索引

> 由 python3 kb.py --write-index 生成；不要手工维护。

[首页](README.md) · [Agent](agent/README.md) · [Infra](infra/README.md)

## 按问题查找

| 主线 | 问题 / 页面 | 状态 |
| --- | --- | --- |
| agent | [我做了什么：三个项目与一条经历主线](agent/01-项目与个人主线.md) | practice-reported |
| agent | [Harness 怎样推进任务，怎样及时停止](agent/02-Harness与执行预算.md) | design |
| agent | [持久化之后，任务怎样正确恢复](agent/03-持久状态与故障恢复.md) | design |
| agent | [上下文、Memory 与长任务主线](agent/04-上下文与Memory.md) | design |
| agent | [Tool、Skill、MCP 与审批怎样配合](agent/05-工具技能与审批.md) | design |
| agent | [什么时候需要多 Agent，A2A 又解决什么](agent/06-多Agent与A2A.md) | design |
| agent | [Harbor 评测：怎样证明 Agent 真的变好](agent/07-Harbor评测与持续改进.md) | design |
| agent | [RSI：从反馈到受控改进](agent/08-RSI与受控改进.md) | learning-plan |
| agent | [面试怎样讲真实经历，怎样判断测试开发机会](agent/09-面试与职业选择.md) | learning-plan |
| agent | [限时 Agent 项目怎样做成可验收的作品](agent/10-实战题与案例模板.md) | learning-plan |
| agent | [开场与项目：可以直接练习的回答](agent/interview/01-开场与项目问答.md) | practice-reported |
| agent | [Harness 追问：从任务语义讲到验证](agent/interview/02-Harness追问.md) | design |
| agent | [事实边界：哪些能说，哪些还要拿证据](agent/interview/03-事实边界与证据.md) | reference |
| agent | [AI4S：通用执行能力怎样服务科研交付](agent/projects/AI4S.md) | practice-reported |
| agent | [YiBuddy：工作助手与端云边界](agent/projects/YiBuddy.md) | practice-reported |
| agent | [智算云：云端 Agent 服务怎样形成交付闭环](agent/projects/智算云.md) | practice-reported |
| infra | [从请求到输出：六个推理概念](infra/01-一次推理请求.md) | reference |
| infra | [单个 vLLM 实例内部怎样工作](infra/02-vLLM单实例.md) | reference |
| infra | [GPU、Pod、Rank、实例和副本如何对应](infra/03-GPU与模型部署.md) | reference |
| infra | [从单实例到路由与 P/D 分离](infra/04-路由与PD分离.md) | reference |
| infra | [沙箱怎样承接 Agent 的执行与恢复](infra/05-沙箱与执行资源.md) | design |
| infra | [从 Kubernetes 到进程：运行时与隔离边界](infra/06-容器运行时与隔离.md) | reference |
| infra | [容量不是一个并发参数：怎样压测与排障](infra/07-容量压测与故障定位.md) | reference |
| infra | [从能听懂到能实操：Infra 学习路线](infra/08-学习路线与实验记录.md) | learning-plan |
| infra | [Agent Infra 答辩：十二个高频追问](infra/interview/01-执行资源答辩.md) | design |
| infra | [沙箱创建：从资源申请到真正可执行](infra/sandbox/01-创建预热与就绪.md) | design |
| infra | [沙箱执行：命令、文件和恢复是三件事](infra/sandbox/02-命令文件与恢复.md) | design |

## 按主题标签

### agent

- [我做了什么：三个项目与一条经历主线](agent/01-项目与个人主线.md)
- [Harness 怎样推进任务，怎样及时停止](agent/02-Harness与执行预算.md)
- [持久化之后，任务怎样正确恢复](agent/03-持久状态与故障恢复.md)
- [上下文、Memory 与长任务主线](agent/04-上下文与Memory.md)
- [Tool、Skill、MCP 与审批怎样配合](agent/05-工具技能与审批.md)
- [什么时候需要多 Agent，A2A 又解决什么](agent/06-多Agent与A2A.md)
- [Harbor 评测：怎样证明 Agent 真的变好](agent/07-Harbor评测与持续改进.md)
- [RSI：从反馈到受控改进](agent/08-RSI与受控改进.md)
- [面试怎样讲真实经历，怎样判断测试开发机会](agent/09-面试与职业选择.md)
- [限时 Agent 项目怎样做成可验收的作品](agent/10-实战题与案例模板.md)
- [开场与项目：可以直接练习的回答](agent/interview/01-开场与项目问答.md)
- [Harness 追问：从任务语义讲到验证](agent/interview/02-Harness追问.md)
- [事实边界：哪些能说，哪些还要拿证据](agent/interview/03-事实边界与证据.md)
- [AI4S：通用执行能力怎样服务科研交付](agent/projects/AI4S.md)
- [YiBuddy：工作助手与端云边界](agent/projects/YiBuddy.md)
- [智算云：云端 Agent 服务怎样形成交付闭环](agent/projects/智算云.md)

### budget

- [Harness 怎样推进任务，怎样及时停止](agent/02-Harness与执行预算.md)

### context

- [上下文、Memory 与长任务主线](agent/04-上下文与Memory.md)

### evaluation

- [Harbor 评测：怎样证明 Agent 真的变好](agent/07-Harbor评测与持续改进.md)
- [RSI：从反馈到受控改进](agent/08-RSI与受控改进.md)
- [面试怎样讲真实经历，怎样判断测试开发机会](agent/09-面试与职业选择.md)
- [Harness 追问：从任务语义讲到验证](agent/interview/02-Harness追问.md)
- [AI4S：通用执行能力怎样服务科研交付](agent/projects/AI4S.md)
- [容量不是一个并发参数：怎样压测与排障](infra/07-容量压测与故障定位.md)

### evidence

- [事实边界：哪些能说，哪些还要拿证据](agent/interview/03-事实边界与证据.md)

### gpu

- [单个 vLLM 实例内部怎样工作](infra/02-vLLM单实例.md)
- [GPU、Pod、Rank、实例和副本如何对应](infra/03-GPU与模型部署.md)
- [从能听懂到能实操：Infra 学习路线](infra/08-学习路线与实验记录.md)
- [沙箱执行：命令、文件和恢复是三件事](infra/sandbox/02-命令文件与恢复.md)

### inference

- [从请求到输出：六个推理概念](infra/01-一次推理请求.md)
- [单个 vLLM 实例内部怎样工作](infra/02-vLLM单实例.md)
- [GPU、Pod、Rank、实例和副本如何对应](infra/03-GPU与模型部署.md)
- [从单实例到路由与 P/D 分离](infra/04-路由与PD分离.md)
- [容量不是一个并发参数：怎样压测与排障](infra/07-容量压测与故障定位.md)
- [从能听懂到能实操：Infra 学习路线](infra/08-学习路线与实验记录.md)

### infra

- [从请求到输出：六个推理概念](infra/01-一次推理请求.md)
- [单个 vLLM 实例内部怎样工作](infra/02-vLLM单实例.md)
- [GPU、Pod、Rank、实例和副本如何对应](infra/03-GPU与模型部署.md)
- [从单实例到路由与 P/D 分离](infra/04-路由与PD分离.md)
- [沙箱怎样承接 Agent 的执行与恢复](infra/05-沙箱与执行资源.md)
- [从 Kubernetes 到进程：运行时与隔离边界](infra/06-容器运行时与隔离.md)
- [容量不是一个并发参数：怎样压测与排障](infra/07-容量压测与故障定位.md)
- [从能听懂到能实操：Infra 学习路线](infra/08-学习路线与实验记录.md)
- [Agent Infra 答辩：十二个高频追问](infra/interview/01-执行资源答辩.md)
- [沙箱创建：从资源申请到真正可执行](infra/sandbox/01-创建预热与就绪.md)
- [沙箱执行：命令、文件和恢复是三件事](infra/sandbox/02-命令文件与恢复.md)

### interview

- [我做了什么：三个项目与一条经历主线](agent/01-项目与个人主线.md)
- [面试怎样讲真实经历，怎样判断测试开发机会](agent/09-面试与职业选择.md)
- [限时 Agent 项目怎样做成可验收的作品](agent/10-实战题与案例模板.md)
- [开场与项目：可以直接练习的回答](agent/interview/01-开场与项目问答.md)
- [Harness 追问：从任务语义讲到验证](agent/interview/02-Harness追问.md)
- [事实边界：哪些能说，哪些还要拿证据](agent/interview/03-事实边界与证据.md)
- [Agent Infra 答辩：十二个高频追问](infra/interview/01-执行资源答辩.md)

### kubernetes

- [GPU、Pod、Rank、实例和副本如何对应](infra/03-GPU与模型部署.md)
- [从 Kubernetes 到进程：运行时与隔离边界](infra/06-容器运行时与隔离.md)
- [沙箱创建：从资源申请到真正可执行](infra/sandbox/01-创建预热与就绪.md)

### learning

- [从能听懂到能实操：Infra 学习路线](infra/08-学习路线与实验记录.md)

### memory

- [上下文、Memory 与长任务主线](agent/04-上下文与Memory.md)
- [限时 Agent 项目怎样做成可验收的作品](agent/10-实战题与案例模板.md)

### multi-agent

- [什么时候需要多 Agent，A2A 又解决什么](agent/06-多Agent与A2A.md)
- [YiBuddy：工作助手与端云边界](agent/projects/YiBuddy.md)

### performance

- [从请求到输出：六个推理概念](infra/01-一次推理请求.md)
- [从单实例到路由与 P/D 分离](infra/04-路由与PD分离.md)
- [容量不是一个并发参数：怎样压测与排障](infra/07-容量压测与故障定位.md)
- [Agent Infra 答辩：十二个高频追问](infra/interview/01-执行资源答辩.md)
- [沙箱创建：从资源申请到真正可执行](infra/sandbox/01-创建预热与就绪.md)

### projects

- [我做了什么：三个项目与一条经历主线](agent/01-项目与个人主线.md)
- [开场与项目：可以直接练习的回答](agent/interview/01-开场与项目问答.md)
- [事实边界：哪些能说，哪些还要拿证据](agent/interview/03-事实边界与证据.md)
- [AI4S：通用执行能力怎样服务科研交付](agent/projects/AI4S.md)
- [YiBuddy：工作助手与端云边界](agent/projects/YiBuddy.md)
- [智算云：云端 Agent 服务怎样形成交付闭环](agent/projects/智算云.md)

### recovery

- [持久化之后，任务怎样正确恢复](agent/03-持久状态与故障恢复.md)
- [Harness 追问：从任务语义讲到验证](agent/interview/02-Harness追问.md)
- [沙箱怎样承接 Agent 的执行与恢复](infra/05-沙箱与执行资源.md)
- [沙箱执行：命令、文件和恢复是三件事](infra/sandbox/02-命令文件与恢复.md)

### research

- [RSI：从反馈到受控改进](agent/08-RSI与受控改进.md)

### runtime

- [Harness 怎样推进任务，怎样及时停止](agent/02-Harness与执行预算.md)
- [持久化之后，任务怎样正确恢复](agent/03-持久状态与故障恢复.md)
- [Harness 追问：从任务语义讲到验证](agent/interview/02-Harness追问.md)
- [智算云：云端 Agent 服务怎样形成交付闭环](agent/projects/智算云.md)

### sandbox

- [Harbor 评测：怎样证明 Agent 真的变好](agent/07-Harbor评测与持续改进.md)
- [智算云：云端 Agent 服务怎样形成交付闭环](agent/projects/智算云.md)
- [沙箱怎样承接 Agent 的执行与恢复](infra/05-沙箱与执行资源.md)
- [从 Kubernetes 到进程：运行时与隔离边界](infra/06-容器运行时与隔离.md)
- [Agent Infra 答辩：十二个高频追问](infra/interview/01-执行资源答辩.md)
- [沙箱创建：从资源申请到真正可执行](infra/sandbox/01-创建预热与就绪.md)
- [沙箱执行：命令、文件和恢复是三件事](infra/sandbox/02-命令文件与恢复.md)

### security

- [Tool、Skill、MCP 与审批怎样配合](agent/05-工具技能与审批.md)
- [从 Kubernetes 到进程：运行时与隔离边界](infra/06-容器运行时与隔离.md)

### storage

- [持久化之后，任务怎样正确恢复](agent/03-持久状态与故障恢复.md)
- [沙箱怎样承接 Agent 的执行与恢复](infra/05-沙箱与执行资源.md)
- [沙箱执行：命令、文件和恢复是三件事](infra/sandbox/02-命令文件与恢复.md)

### tools

- [Tool、Skill、MCP 与审批怎样配合](agent/05-工具技能与审批.md)
- [什么时候需要多 Agent，A2A 又解决什么](agent/06-多Agent与A2A.md)
- [限时 Agent 项目怎样做成可验收的作品](agent/10-实战题与案例模板.md)
- [AI4S：通用执行能力怎样服务科研交付](agent/projects/AI4S.md)
- [YiBuddy：工作助手与端云边界](agent/projects/YiBuddy.md)

## 按来源追踪

### src-harbor-samples

来源：[来源：两份 Harbor 本地历史结果核对](agent/sources/Harbor样本核对.md)

- [Harbor 评测：怎样证明 Agent 真的变好](agent/07-Harbor评测与持续改进.md)

### src-agent-session

来源：[Agent 会话摘要与证据边界](agent/sources/会话摘要.md)

- [我做了什么：三个项目与一条经历主线](agent/01-项目与个人主线.md)
- [Harness 怎样推进任务，怎样及时停止](agent/02-Harness与执行预算.md)
- [持久化之后，任务怎样正确恢复](agent/03-持久状态与故障恢复.md)
- [上下文、Memory 与长任务主线](agent/04-上下文与Memory.md)
- [Tool、Skill、MCP 与审批怎样配合](agent/05-工具技能与审批.md)
- [什么时候需要多 Agent，A2A 又解决什么](agent/06-多Agent与A2A.md)
- [Harbor 评测：怎样证明 Agent 真的变好](agent/07-Harbor评测与持续改进.md)
- [RSI：从反馈到受控改进](agent/08-RSI与受控改进.md)
- [面试怎样讲真实经历，怎样判断测试开发机会](agent/09-面试与职业选择.md)
- [限时 Agent 项目怎样做成可验收的作品](agent/10-实战题与案例模板.md)
- [开场与项目：可以直接练习的回答](agent/interview/01-开场与项目问答.md)
- [事实边界：哪些能说，哪些还要拿证据](agent/interview/03-事实边界与证据.md)
- [YiBuddy：工作助手与端云边界](agent/projects/YiBuddy.md)

### src-public-agent

来源：[Agent 公开参考入口](agent/sources/公开参考.md)

- [Tool、Skill、MCP 与审批怎样配合](agent/05-工具技能与审批.md)
- [什么时候需要多 Agent，A2A 又解决什么](agent/06-多Agent与A2A.md)
- [Harbor 评测：怎样证明 Agent 真的变好](agent/07-Harbor评测与持续改进.md)
- [RSI：从反馈到受控改进](agent/08-RSI与受控改进.md)
- [面试怎样讲真实经历，怎样判断测试开发机会](agent/09-面试与职业选择.md)
- [限时 Agent 项目怎样做成可验收的作品](agent/10-实战题与案例模板.md)

### src-feishu-interview

来源：[来源：Harness 面试准备总手册](agent/sources/飞书总手册摘要.md)

- [我做了什么：三个项目与一条经历主线](agent/01-项目与个人主线.md)
- [Harness 怎样推进任务，怎样及时停止](agent/02-Harness与执行预算.md)
- [持久化之后，任务怎样正确恢复](agent/03-持久状态与故障恢复.md)
- [上下文、Memory 与长任务主线](agent/04-上下文与Memory.md)
- [Harbor 评测：怎样证明 Agent 真的变好](agent/07-Harbor评测与持续改进.md)
- [开场与项目：可以直接练习的回答](agent/interview/01-开场与项目问答.md)
- [Harness 追问：从任务语义讲到验证](agent/interview/02-Harness追问.md)
- [事实边界：哪些能说，哪些还要拿证据](agent/interview/03-事实边界与证据.md)
- [AI4S：通用执行能力怎样服务科研交付](agent/projects/AI4S.md)
- [YiBuddy：工作助手与端云边界](agent/projects/YiBuddy.md)
- [智算云：云端 Agent 服务怎样形成交付闭环](agent/projects/智算云.md)
- [Agent Infra 答辩：十二个高频追问](infra/interview/01-执行资源答辩.md)
- [沙箱创建：从资源申请到真正可执行](infra/sandbox/01-创建预热与就绪.md)
- [沙箱执行：命令、文件和恢复是三件事](infra/sandbox/02-命令文件与恢复.md)

### src-feishu-project-story

来源：[来源：准备手册 Q&A 1](agent/sources/飞书项目答辩摘要.md)

- [我做了什么：三个项目与一条经历主线](agent/01-项目与个人主线.md)
- [Harness 怎样推进任务，怎样及时停止](agent/02-Harness与执行预算.md)
- [持久化之后，任务怎样正确恢复](agent/03-持久状态与故障恢复.md)
- [上下文、Memory 与长任务主线](agent/04-上下文与Memory.md)
- [开场与项目：可以直接练习的回答](agent/interview/01-开场与项目问答.md)
- [Harness 追问：从任务语义讲到验证](agent/interview/02-Harness追问.md)
- [事实边界：哪些能说，哪些还要拿证据](agent/interview/03-事实边界与证据.md)
- [AI4S：通用执行能力怎样服务科研交付](agent/projects/AI4S.md)
- [智算云：云端 Agent 服务怎样形成交付闭环](agent/projects/智算云.md)

### src-infra-session

来源：[Infra 会话摘要与修正记录](infra/sources/会话摘要.md)

- [从请求到输出：六个推理概念](infra/01-一次推理请求.md)
- [单个 vLLM 实例内部怎样工作](infra/02-vLLM单实例.md)
- [GPU、Pod、Rank、实例和副本如何对应](infra/03-GPU与模型部署.md)
- [从单实例到路由与 P/D 分离](infra/04-路由与PD分离.md)
- [沙箱怎样承接 Agent 的执行与恢复](infra/05-沙箱与执行资源.md)
- [从 Kubernetes 到进程：运行时与隔离边界](infra/06-容器运行时与隔离.md)
- [容量不是一个并发参数：怎样压测与排障](infra/07-容量压测与故障定位.md)
- [从能听懂到能实操：Infra 学习路线](infra/08-学习路线与实验记录.md)

### src-public-infra

来源：[Infra 公开参考入口](infra/sources/公开参考.md)

- [从请求到输出：六个推理概念](infra/01-一次推理请求.md)
- [单个 vLLM 实例内部怎样工作](infra/02-vLLM单实例.md)
- [GPU、Pod、Rank、实例和副本如何对应](infra/03-GPU与模型部署.md)
- [从单实例到路由与 P/D 分离](infra/04-路由与PD分离.md)
- [沙箱怎样承接 Agent 的执行与恢复](infra/05-沙箱与执行资源.md)
- [从 Kubernetes 到进程：运行时与隔离边界](infra/06-容器运行时与隔离.md)
- [容量不是一个并发参数：怎样压测与排障](infra/07-容量压测与故障定位.md)
- [从能听懂到能实操：Infra 学习路线](infra/08-学习路线与实验记录.md)

### src-feishu-agent-infra

来源：[来源：Agent-Infra 专题](infra/sources/飞书Agent-Infra摘要.md)

- [事实边界：哪些能说，哪些还要拿证据](agent/interview/03-事实边界与证据.md)
- [沙箱怎样承接 Agent 的执行与恢复](infra/05-沙箱与执行资源.md)
- [Agent Infra 答辩：十二个高频追问](infra/interview/01-执行资源答辩.md)
- [沙箱创建：从资源申请到真正可执行](infra/sandbox/01-创建预热与就绪.md)
- [沙箱执行：命令、文件和恢复是三件事](infra/sandbox/02-命令文件与恢复.md)

## 按时间与状态

| 更新日期 | 状态 | 可信度 | 页面 |
| --- | --- | --- | --- |
| 2026-10-08 | design | inferred | [沙箱执行：命令、文件和恢复是三件事](infra/sandbox/02-命令文件与恢复.md) |
| 2026-10-08 | design | inferred | [沙箱创建：从资源申请到真正可执行](infra/sandbox/01-创建预热与就绪.md) |
| 2026-10-08 | design | inferred | [Agent Infra 答辩：十二个高频追问](infra/interview/01-执行资源答辩.md) |
| 2026-10-08 | learning-plan | inferred | [从能听懂到能实操：Infra 学习路线](infra/08-学习路线与实验记录.md) |
| 2026-10-08 | reference | inferred | [容量不是一个并发参数：怎样压测与排障](infra/07-容量压测与故障定位.md) |
| 2026-10-08 | reference | inferred | [从 Kubernetes 到进程：运行时与隔离边界](infra/06-容器运行时与隔离.md) |
| 2026-10-08 | design | inferred | [沙箱怎样承接 Agent 的执行与恢复](infra/05-沙箱与执行资源.md) |
| 2026-10-08 | reference | inferred | [从单实例到路由与 P/D 分离](infra/04-路由与PD分离.md) |
| 2026-10-08 | reference | inferred | [GPU、Pod、Rank、实例和副本如何对应](infra/03-GPU与模型部署.md) |
| 2026-10-08 | reference | inferred | [单个 vLLM 实例内部怎样工作](infra/02-vLLM单实例.md) |
| 2026-10-08 | reference | inferred | [从请求到输出：六个推理概念](infra/01-一次推理请求.md) |
| 2026-10-08 | practice-reported | source-reported | [智算云：云端 Agent 服务怎样形成交付闭环](agent/projects/智算云.md) |
| 2026-10-08 | practice-reported | source-reported | [YiBuddy：工作助手与端云边界](agent/projects/YiBuddy.md) |
| 2026-10-08 | practice-reported | source-reported | [AI4S：通用执行能力怎样服务科研交付](agent/projects/AI4S.md) |
| 2026-10-08 | reference | source-reported | [事实边界：哪些能说，哪些还要拿证据](agent/interview/03-事实边界与证据.md) |
| 2026-10-08 | design | inferred | [Harness 追问：从任务语义讲到验证](agent/interview/02-Harness追问.md) |
| 2026-10-08 | practice-reported | source-reported | [开场与项目：可以直接练习的回答](agent/interview/01-开场与项目问答.md) |
| 2026-10-08 | learning-plan | inferred | [限时 Agent 项目怎样做成可验收的作品](agent/10-实战题与案例模板.md) |
| 2026-10-08 | learning-plan | inferred | [面试怎样讲真实经历，怎样判断测试开发机会](agent/09-面试与职业选择.md) |
| 2026-10-08 | learning-plan | experimental | [RSI：从反馈到受控改进](agent/08-RSI与受控改进.md) |
| 2026-10-08 | design | inferred | [Harbor 评测：怎样证明 Agent 真的变好](agent/07-Harbor评测与持续改进.md) |
| 2026-10-08 | design | inferred | [什么时候需要多 Agent，A2A 又解决什么](agent/06-多Agent与A2A.md) |
| 2026-10-08 | design | inferred | [Tool、Skill、MCP 与审批怎样配合](agent/05-工具技能与审批.md) |
| 2026-10-08 | design | inferred | [上下文、Memory 与长任务主线](agent/04-上下文与Memory.md) |
| 2026-10-08 | design | inferred | [持久化之后，任务怎样正确恢复](agent/03-持久状态与故障恢复.md) |
| 2026-10-08 | design | inferred | [Harness 怎样推进任务，怎样及时停止](agent/02-Harness与执行预算.md) |
| 2026-10-08 | practice-reported | source-reported | [我做了什么：三个项目与一条经历主线](agent/01-项目与个人主线.md) |
