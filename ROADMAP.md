# NexusPay 支付编排系统 Roadmap

基于 Hyperswitch 对标分析，列出功能差距及实施优先级。

> **对标基线**：Hyperswitch (42.8k stars, Rust, 100+ PSP, 微服务架构)
> **最新对标日期**：2026-06-06

---

## Hyperswitch 对标总览

| 维度 | Hyperswitch | NexusPay | 差距 |
|---|---|---|---|
| 连接器数量 | **100+**（含直连收单行 TSYS/JPM） | **3**（Stripe/Square/Braintree） | 🔴 |
| Card Vault | PCI 合规独立服务 + BYOV (VGS/TokenEx) | 简单 `payment_tokens` 表 | 🔴 |
| 支付方式 | 卡 + 钱包(Apple/Google/PayPal/Samsung) + BNPL(Klarna) + Pay by Bank | 仅卡 | 🔴 |
| Cost Observability | AI 驱动费用分析 + 隐藏费用检测 + 降级告警 | 基础费率计算 + 异常检测 | 🟡 |
| 架构 | 微服务 (Router + Scheduler + Vault + Encryption + Prism) | 单体 Express | 🟡 |
| 调度器 | Producer/Consumer + Redis 队列（分布式） | 单进程 setInterval（无锁） | 🟡 |
| Workflow Builder | Control Center 可视化工作流编辑器 | 无 | 🟡 |
| Web SDK | 客户端 checkout SDK | 无 | 🟡 |
| 智能路由 | 基于预测授权率 + 成本 + 延迟多维路由 | 加权随机 + 最低成本 | 🟢 |
| 重试引擎 | 卡BIN+区域+方式调优 + 惩罚预算 | 拒绝码驱动 + BIN路由 + 3DS升级 | 🟢 |
| 对账 | 2-way + 3-way + 错峰调度 | 3-way + PSP自动拉取 + 银行结算 | 🟢 |
| 3DS | PSP无关认证抽象层 | 2.x + 1.0 + frictionless + 责任转移 | 🟢 |
| 风控 | 独立 fraud connector 集成 | 规则引擎 + 评分 + 黑白名单 + 审核队列 | 🟢 |
| 网络令牌化 | 有 | Visa/MC/Amex + 生命周期管理 | 🟢 |
| 退款同步 | 有 | ✅ 刚完成 P1-8（PSP查询+重试+webhook+报表） | 🟢 |
| MFA | 文档未提及 | TOTP + 备份码 | ✅ 领先 |
| 部署复杂度 | 多服务需编排 | 单个 docker-compose | ✅ 领先 |

---

## P0 - 核心能力（必须有）✅ 全部完成

> 资金安全、交易成功率、合规性基础

### 1. 智能重试引擎（Revenue Recovery）✅

**目标**：自动恢复失败交易，提升成功率 20-30%

**功能点**：
- [x] 拒绝码解析与分类（15 种 Stripe 错误码）
- [x] 基于错误类型的重试策略
- [x] 立即重试（NETWORK_ERROR）
- [x] 延迟重试（INSUFFICIENT_FUNDS, LIMIT_EXCEEDED）
- [x] 重试预算控制（最大次数、惩罚阈值）
- [x] 时间窗口调度
- [x] 卡 BIN 路由优化（基于历史成功率 + 延迟加权选 provider）
- [x] 3DS 升级重试（软拒绝后自动升级 3DS 二次尝试）

**实现文件**：
- `services/retry.service.ts` - 重试策略与执行（含 BIN 路由与 3DS 升级）
- `services/decline-code.service.ts` - 拒绝码解析
- `services/scheduler.service.ts` - 定时任务
- `services/bin-routing.service.ts` - 卡 BIN 注册与优选 provider 查询

**数据模型**：
```sql
retry_configs             -- 重试配置
retry_attempts            -- 重试记录（含 card_bin / bin_routing_provider / three_ds_upgrade_attempted）
decline_code_mappings     -- 拒绝码映射
card_bin_registry         -- BIN 注册表（card_network / issuer / preferred_provider / provider_performance）
```

**完成日期**：2026-06-04

---

### 2. 对账系统（Reconciliation）✅

**目标**：确保资金一致性，消除收入泄漏

**功能点**：
- [x] PSP 交易数据导入（手工）
- [x] 三方对账（内部 + PSP + 银行）
- [x] 差异检测与报告
- [x] 手动调整与标记
- [x] 对账状态流转
- [x] PSP 数据自动拉取（Stripe Balance Transactions，定时 15 分钟）
- [x] 银行结算数据导入（JSON 文件 + 自动匹配）
- [x] 历史回溯对账（366 天内任意日期范围，支持强制重建）

**实现文件**：
- `services/reconciliation.service.ts` - 对账核心逻辑
- `services/psp-sync.service.ts` - PSP 自动拉取
- `routes/reconciliation.routes.ts` - API 端点

**完成日期**：2026-06-04

---

### 3. 渠道健康监控与自动降级 ✅

**目标**：实时监控渠道状态，自动故障转移

**功能点**：
- [x] 成功率实时统计
- [x] 错误率阈值告警
- [x] 自动禁用/降级
- [x] 健康度看板
- [x] 延迟监控（avg / p95 / p99）
- [x] 历史趋势分析（小时 / 天粒度）

**实现文件**：
- `services/health-monitor.service.ts`
- `routes/health.routes.ts`

**完成日期**：2026-06-04

---

### 4. 完整 3DS 认证流程 ✅

**目标**：合规要求，减少欺诈

**功能点**：
- [x] 3DS 会话管理
- [x] 挑战流程处理
- [x] 3DS 数据传递（ECI, CAVV, XID）
- [x] 3DS 1.0 支持（PaReq / PaRes / MD redirect）
- [x] Frictionless 流程
- [x] 责任转移记录（ECI-based liability shift）

**实现文件**：
- `services/threeds.service.ts`
- `routes/threeds.routes.ts`

**完成日期**：2026-06-04

---

## P1 - 重要功能（应该有）✅ 全部完成

> 提升效率、降低成本、增强竞争力

### 5. 网络令牌化（Network Tokenization）✅

**目标**：授权率提升 3-5%，降低欺诈 26%

**功能点**：
- [x] Visa/MC/Amex 网络令牌
- [x] 令牌生命周期管理
- [x] Cryptogram 生成
- [x] 令牌刷新/删除
- [x] PAN 回退机制

**实现文件**：
- `services/network-token.service.ts`
- `routes/network-token.routes.ts`
- `services/scheduler.service.ts`（30分钟定时刷新）

**完成日期**：2026-06-12

---

### 6. 成本优化路由 ✅

**目标**：动态选择最低成本渠道

**功能点**：
- [x] 费率配置管理（`fee_schedules` CRUD）
- [x] 实时成本计算（cost preview API）
- [x] 成本路由规则（`cost_aware` 规则标记 + 自动选最便宜渠道）
- [x] 成本报表（月度聚合报表）
- [x] 异常费用检测（PSP 实际费 vs 预期费）

**实现文件**：
- `services/fee-schedule.service.ts`
- `routes/fee-schedule.routes.ts`
- `services/routing-engine.ts`

**完成日期**：2026-06-12

---

### 7. 风控规则引擎 ✅

**目标**：欺诈预防，减少拒付

**功能点**：
- [x] 规则配置引擎（6 种规则类型）
- [x] 风险评分（0-100，LOW/MEDIUM/HIGH/DECLINED）
- [x] 黑名单/白名单（卡号、邮箱、IP、设备指纹、国家、卡BIN）
- [x] 金额阈值 + 频率限制（15分钟窗口）
- [x] 人工审核队列（PENDING → APPROVED / REJECTED）
- [x] confirm() 集成（自动阻止/标记高风险交易）

**实现文件**：
- `services/risk-engine.service.ts`
- `routes/risk.routes.ts`

**完成日期**：2026-06-12

---

### 8. 退款状态同步 ✅

**目标**：完整退款生命周期管理

**功能点**：
- [x] 渠道退款状态查询（Stripe/SBraintree/SBraintree 主动轮询）
- [x] Webhook 状态更新（三渠道全覆盖：Stripe `refund.updated` + Square `refund.updated` + Braintree `transaction_refunded`）
- [x] 退款失败处理（指数退避重试：5min→30min→2h，max 3次）
- [x] 退款超时自动标记（120min PENDING → FAILED）
- [x] 退款统计报表（Dashboard 卡片 + stats API）
- [x] Dashboard Sync/Retry 按钮 + 批量同步

**实现文件**：
- `services/refund-sync.service.ts` — 核心同步引擎
- `services/provider-dispatcher.ts` — `queryRefundStatus()` 三渠道查询
- `routes/merchant.routes.ts` — stats / sync / retry / sync-all 端点
- `routes/webhook-inbound.routes.ts` — Braintree `transaction_refunded` 处理
- `services/scheduler.service.ts` — 3 个定时任务（sync 10min / retry 5min / timeout 30min）
- `services/refund.service.ts` — 创建时设置 sync_status
- `db/migrations/009_refund_sync.ts` — sync_status / last_synced_at / sync_attempts / retry_count / next_retry_at

**完成日期**：2026-06-06

---

## P2 - 增强功能（Hyperswitch 对标后重排）

> 缩小与 Hyperswitch 的核心差距，差异化竞争力

### 9. provider-dispatcher 策略化重构 🔧

**目标**：为 P3 大规模渠道扩展铺路（前置依赖）

**功能点**：
- [ ] 抽象 `ConnectorStrategy` 接口（charge / refund / capture / cancel / queryRefund / queryPayment）
- [ ] Stripe / Square / Braintree 实现为独立策略类
- [ ] 策略注册表（Map<provider, ConnectorStrategy>）
- [ ] 消除 631 行 switch/case
- [ ] 新增 connector 只需实现接口 + 注册，不改核心代码

**数据模型**：无需变更

**工作量**：1 周

**依赖**：无（独立重构）

---

### 10. Card Vault（PCI 合规卡存储）

**目标**：安全存储 + 多 PSP 复用卡信息，Hyperswitch 对标

**功能点**：
- [ ] 独立 Vault 服务（可选：内嵌 Express 路由 或 独立微服务）
- [ ] 卡号加密存储（AES-256-GCM，与现有 crypto 工具复用）
- [ ] Token 化：`vault_tok_…` 格式，跨 PSP 复用
- [ ] 支持存储类型：card / bank_account / wallet
- [ ] BYOV 接口：对接外部 Vault（VGS / TokenEx 兼容）
- [ ] PCI DSS 合规检查清单
- [ ] 令牌过期 + 自动清理

**数据模型**：
```sql
vault_tokens            -- 保险库令牌（token_hash / token_type / encrypted_data / merchant_id / customer_id）
vault_token_usage       -- 令牌使用记录（payment_intent_id / psp / used_at）
vault_providers         -- 外部 Vault 配置（VGS / TokenEx / custom）
```

**工作量**：3-4 周

---

### 11. 新增渠道：Adyen + PayPal

**目标**：覆盖面最大的两个 PSP，Hyperswitch 对标

**功能点**：
- [ ] Adyen：Checkout API 集成（/payments + /payments/details）
- [ ] Adyen：Webhook 签名验证（HMAC-SHA256）
- [ ] Adyen：3DS 适配
- [ ] PayPal：Orders API v2 集成
- [ ] PayPal：Webhook 验证（POST + 验证 URL）
- [ ] PayPal：退款 + 争议适配
- [ ] 两个渠道均实现 `ConnectorStrategy` 接口

**数据模型**：复用现有 `provider_accounts` + `provider_config`

**工作量**：各 2 周，共 4 周

**前置依赖**：#9 策略化重构

---

### 12. 钱包 / APM 支持

**目标**：Apple Pay / Google Pay 提升 checkout 转化率，Hyperswitch 对标

**功能点**：
- [ ] Apple Pay：PKPaymentToken 解密 + PSP 透传
- [ ] Google Pay：PaymentData 解析 + gateway token 适配
- [ ] `/pub/tokenize` 支持 wallet PM type
- [ ] Payment Links 支持钱包选项
- [ ] Dashboard 显示支付方式类型

**数据模型**：
```sql
-- payment_intents 新增列：wallet_type（APPLE_PAY / GOOGLE_PAY / null）
```

**工作量**：2-3 周

**前置依赖**：#11 Adyen（Adyen 对 Apple Pay 支持最好）

---

### 13. 订阅/周期扣款

**目标**：支持 SaaS 订阅场景

**功能点**：
- [ ] 订阅计划管理（金额/周期/试用期）
- [ ] 自动扣款调度（cron 表达式）
- [ ] 失败重试策略（与现有 RetryEngine 复用）
- [ ] 订阅状态机（ACTIVE / PAST_DUE / CANCELED / EXPIRED）
- [ ] 订阅发票生成

**数据模型**：
```sql
subscriptions             -- 订阅
subscription_plans        -- 订阅计划
subscription_invoices     -- 订阅发票
```

**工作量**：3-4 周

---

### 14. Cost Observability 增强

**目标**：缩小与 Hyperswitch Cost Observability 的差距

**功能点**：
- [ ] 隐藏费用检测（cross-border / currency conversion / scheme fee）
- [ ] 降级告警（IC++ 降级为 blended rate）
- [ ] 费用趋势图（Dashboard Chart.js 折线图）
- [ ] 按 PSP / 卡类型 / 区域维度 drill-down
- [ ] 费用优化建议（AI 规则：建议切换 PSP 可节省 X%）

**数据模型**：复用 `cost_analytics` / `fee_anomalies`，新增 `fee_insights`

**工作量**：2 周

---

## P3 - 长尾功能

> 高级场景、渠道深度、边缘能力

### 15. 分账支付（Split Payments）

- [ ] 多支付方式组合（卡 + 礼品卡 + 钱包）
- [ ] 顺序授权 + 余额查询
- [ ] 失败回滚

**工作量**：2-3 周

---

### 16. Click to Pay

- [ ] EMVCo 标准
- [ ] Passkeys 认证
- [ ] 统一 SDK

**工作量**：4-6 周（需网络认证）

---

### 17. L2/L3 数据

- [ ] L2/L3 数据字段
- [ ] 数据校验 + 发票关联

**工作量**：1-2 周

---

### 18. 更多渠道扩展

| 渠道 | 覆盖 | 优先级 |
|---|---|---|
| Checkout.com | 欧洲 | 中 |
| Worldpay | 美国 | 中 |
| Cybersource | 全球 | 中 |
| GlobalPayments | 全球 | 低 |
| Fiserv | 北美 | 低 |
| 支付宝/微信支付 | 中国 | 低 |

**工作量**：每渠道 1-2 周（策略化重构后）

---

## P4 - 基础设施

> 生产就绪、可观测性、质量保障

### 19. 分布式锁（调度器多实例安全）

**目标**：消除单点，支持多实例部署

**方案**：
- [ ] `pg_advisory_lock`（首选，零额外依赖）
- [ ] 每个定时任务获取独立 advisory lock
- [ ] 锁超时自动释放（防止死锁）

**工作量**：0.5 周

---

### 20. 监控告警体系

- [ ] Prometheus 指标（替换现有 stub `/actuator/prometheus`）
- [ ] Grafana Dashboard（支付量 / 成功率 / p95延迟 / 错误分布）
- [ ] 告警规则（成功率 < 90% → Slack/邮件）

**工作量**：2 周

---

### 21. 测试覆盖

- [ ] 核心集成测试（retry / reconciliation / 3DS / refund-sync）
- [ ] 前端 E2E 测试（Playwright / Cypress）
- [ ] 性能基准测试（k6 / autocannon）

**工作量**：持续

---

### 22. 文档完善

- [ ] API 文档（OpenAPI / Swagger）
- [ ] 架构文档（C4 模型）
- [ ] 运维手册（部署 / 备份 / 恢复 / 扩缩容）
- [ ] 故障排查指南（常见 PSP 错误码 + 处理方案）

**工作量**：持续

---

## 实施计划（Hyperswitch 对标后更新）

### ✅ 已完成（P0 + P1）

| 阶段 | 内容 | 状态 |
|---|---|---|
| P0-1 | 智能重试引擎（含 BIN 路由 + 3DS 升级） | ✅ |
| P0-2 | 对账系统（3-way + PSP 自动拉取 + 银行结算） | ✅ |
| P0-3 | 渠道健康监控 + 自动降级（含 p95/p99） | ✅ |
| P0-4 | 完整 3DS 认证（2.x + 1.0 + frictionless + 责任转移） | ✅ |
| P1-5 | 网络令牌化（Visa/MC/Amex） | ✅ |
| P1-6 | 成本优化路由（费率表 + cost_aware + 异常检测） | ✅ |
| P1-7 | 风控规则引擎（6 种规则 + 评分 + 黑白名单 + 审核） | ✅ |
| P1-8 | 退款状态同步（PSP 查询 + webhook + 重试 + 报表） | ✅ |

### Q3 2026 — P2 缩小 Hyperswitch 差距

| 优先级 | 内容 | 周数 | 前置依赖 |
|---|---|---|---|
| **P2-1** | provider-dispatcher 策略化重构 | 1 | — |
| **P2-2** | Card Vault（PCI 合规卡存储） | 3-4 | — |
| **P2-3** | 新增 Adyen + PayPal | 4 | P2-1 |
| **P2-4** | 钱包/APM（Apple Pay + Google Pay） | 2-3 | P2-3 |
| **P2-5** | 订阅/周期扣款 | 3-4 | — |
| **P2-6** | Cost Observability 增强 | 2 | — |

### Q4 2026 — P3/P4 长尾 + 基础设施

| 优先级 | 内容 | 周数 |
|---|---|---|
| **P3-1** | 分账支付（Split Payments） | 2-3 |
| **P3-2** | Click to Pay | 4-6 |
| **P3-3** | L2/L3 数据 | 1-2 |
| **P3-4** | 渠道扩展（Checkout.com / Worldpay / Cybersource） | 3-6 |
| **P4-1** | 分布式锁（pg_advisory_lock） | 0.5 |
| **P4-2** | Prometheus + Grafana | 2 |
| **P4-3** | 核心集成测试 | 2 |
| **P4-4** | OpenAPI 文档 | 1 |

---

## 风险与依赖

| 风险 | 缓解措施 |
|---|---|
| 卡网络认证周期长（Apple Pay / Click to Pay） | 提前申请，并行开发 |
| 渠道对接复杂度高（Adyen / PayPal） | P2-1 策略化重构后再加渠道 |
| 对账数据格式不统一 | 已有标准化转换层 |
| 3DS 合规要求 | 参考 EMVCo 规范 |
| **调度器多实例重复执行** | 🔜 P4-1 pg_advisory_lock（0.5 周快速解决） |
| **Vault PCI 合规门槛** | 渐进式：先做 token 复用，再做完整 PCI |
| **provider-dispatcher 架构债务** | 🔜 P2-1 策略化重构（P3 渠道扩展前置依赖） |

---

## 成功指标

| 指标 | 当前 | P2 目标 | Hyperswitch 对标 |
|---|---|---|---|
| PSP 连接器数量 | 3 | 5+ (Adyen + PayPal) | 100+ |
| 支付方式 | 卡 | 卡 + Apple Pay + Google Pay | 卡 + 钱包 + BNPL + Pay by Bank |
| Card Vault | ❌ | ✅ PCI 合规 | ✅ 独立服务 + BYOV |
| 支付成功率 | 90%+ | 93%+ | 95%+ |
| 重试恢复率 | 20%+ | 25%+ | 20-30% |
| 对账自动化率 | 90%+ | 95%+ | 90%+ |
| 渠道可用性 | 99.9% | 99.95% | 99.9% |
| 退款处理时效 | T+1 | T+0（实时同步） | T+1 |
| 部署复杂度 | ✅ 单 docker-compose | ✅ 单 docker-compose | 多服务编排 |

---

## P1 完成总结

**已实现功能（P0 4 模块 + P1 4 模块全部闭环）**：

| 模块 | 内容 |
|---|---|
| P0-1 | 智能重试引擎：立即重试 + 延迟重试 + BIN 路由 + 3DS 升级重试 |
| P0-2 | 对账系统：3-way + PSP 自动拉取 + 银行结算 + 366 天回溯 |
| P0-3 | 渠道健康：错误率阈值 + p95/p99 延迟 + 自动降级 + 历史趋势 |
| P0-4 | 3DS 认证：2.x + 1.0 + frictionless + 责任转移 |
| P1-5 | 网络令牌化：Visa/MC/Amex + 生命周期 + cryptogram + PAN 回退 |
| P1-6 | 成本优化：费率表 CRUD + cost_aware 路由 + 异常检测 + 月度报表 |
| P1-7 | 风控引擎：6 种规则 + 0-100 评分 + 黑白名单 + 频率检测 + 审核队列 |
| P1-8 | 退款同步：PSP 查询 + 三渠道 webhook + 重试 + 超时 + 统计报表 |

**代码统计**：
- 服务文件：22 个
- 路由文件：13 个
- 数据库迁移：9 个
- 数据库表：30+ 张
- 定时任务：8 个

**Scheduler 周期任务（当前）**：
| 任务 | 频率 |
|---|---|
| 支付重试执行 | 1 分钟 |
| 渠道健康检查 | 5 分钟 |
| PSP 自动拉取 | 15 分钟 |
| 结算新鲜度检查 | 6 小时 |
| 网络令牌刷新 | 30 分钟 |
| 退款状态同步 | 10 分钟 |
| 退款失败重试 | 5 分钟 |
| 退款超时检测 | 30 分钟 |

**P2 启动前必须解决**：
- ⚠️ `provider-dispatcher` 策略化重构（P2-1，1 周）— P3 渠道扩展的前置依赖
- ⚠️ 分布式锁 `pg_advisory_lock`（P4-1，0.5 周）— 生产多实例部署前提