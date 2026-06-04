# NexusPay 支付编排系统 Roadmap

基于 Hyperswitch 对标分析，列出功能差距及实施优先级。

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

**新增 API**：
- `GET  /api/v1/bin/:bin` - 查询 BIN 信息与优选 provider
- `GET  /api/v1/bin` - 列出 BIN 注册表
- `POST /api/v1/bin` - 注册/更新 BIN（ADMIN）
- `POST /api/v1/payment-intents/:intentId/3ds-upgrade-retry` - 触发 3DS 升级重试

**完成日期**：2026-06-04（BIN 路由 + 3DS 升级补齐）

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
- `services/reconciliation.service.ts` - 对账核心逻辑（含银行结算 + 历史回溯）
- `services/psp-sync.service.ts` - PSP 自动拉取（Stripe / Square / Braintree 适配器）
- `routes/reconciliation.routes.ts` - API 端点

**数据模型**：
```sql
reconciliation_sources         -- 对账数据源（PSP / BANK）
provider_transactions          -- 渠道原始交易
reconciliation_reports         -- 对账报告
reconciliation_discrepancies   -- 差异记录
settlement_records             -- 银行结算记录（settlement_reference / value_date / matched_count）
```

**新增 API**：
- `POST /api/v1/merchants/:merchantId/reconciliation/sync` - 手工触发 PSP 同步（FINANCE）
- `POST /api/v1/reconciliation/sources/:sourceId/sync` - 同步单个数据源
- `POST /api/v1/merchants/:merchantId/reconciliation/settlements` - 导入银行结算（FINANCE）
- `GET  /api/v1/merchants/:merchantId/reconciliation/settlements` - 列出结算记录
- `POST /api/v1/merchants/:merchantId/reconciliation/backfill` - 历史回溯对账（FINANCE，最多 366 天）

**完成日期**：2026-06-04（PSP 自动拉取 + 银行结算 + 历史回溯补齐）

---

### 3. 渠道健康监控与自动降级 ✅

**目标**：实时监控渠道状态，自动故障转移

**功能点**：
- [x] 成功率实时统计
- [x] 错误率阈值告警
- [x] 自动禁用/降级
- [x] 健康度看板
- [x] 延迟监控（基于 `request_latency_samples` 的 avg / p95 / p99）
- [x] 历史趋势分析（小时 / 天粒度，PostgreSQL 时序聚合）

**实现文件**：
- `services/health-monitor.service.ts` - 健康监控（真实延迟分位数 + 趋势）
- `routes/health.routes.ts` - API 端点

**数据模型**：
```sql
provider_health_metrics   -- 渠道健康指标（含 avg/p95/p99/sample_count）
provider_outages          -- 渠道故障记录（含 duration_minutes 自动计算）
request_latency_samples   -- 原始延迟样本（7 天保留）
```

**新增 API**：
- `GET /api/v1/connectors/:connectorAccountId/health/trend` - 延迟趋势（?from&to&granularity=hour|day）

**完成日期**：2026-06-04（延迟分位数 + 趋势补齐）

---

### 4. 完整 3DS 认证流程 ✅

**目标**：合规要求，减少欺诈

**功能点**：
- [x] 3DS 会话管理
- [x] 挑战流程处理
- [x] 3DS 数据传递（ECI, CAVV, XID）
- [x] 3DS 1.0 支持（PaReq / PaRes / MD redirect 流程）
- [x] Frictionless 流程（ACS 返回无挑战时自动完成）
- [x] 责任转移记录（基于 ECI 的 liability shift 推导，写入 `three_ds_liability_shifts`）

**实现文件**：
- `services/threeds.service.ts` - 3DS 核心逻辑（含 1.0 / 2.x 双协议 + 责任转移）
- `routes/threeds.routes.ts` - API 端点

**数据模型**：
```sql
three_ds_sessions            -- 3DS 会话（含 flow_type / frictionless_flow / pareq / pares / md）
three_ds_challenges          -- 挑战记录
three_ds_liability_shifts    -- 责任转移记录（liability_shift / eci / chargeback_protected）
```

**新增 API**：
- `POST /api/v1/3ds/sessions/:sessionId/pares` - 3DS 1.0 PaRes 回传
- `GET  /api/v1/payment-intents/:intentId/3ds/liability-shifts` - 查询责任转移记录

**完成日期**：2026-06-04（1.0 + frictionless + liability shift 补齐）

---

## P1 - 重要功能（应该有）

> 提升效率、降低成本、增强竞争力

### 5. 网络令牌化（Network Tokenization）

**目标**：授权率提升 3-5%，降低欺诈 26%

**功能点**：
- [ ] Visa/MC/Amex 网络令牌
- [ ] 令牌生命周期管理
- [ ] Cryptogram 生成
- [ ] 令牌刷新/删除
- [ ] PAN 回退机制

**数据模型**：
```sql
network_tokens            -- 网络令牌
token_lifecycle_events    -- 令牌生命周期事件
```

**工作量**：4-5 周（需与卡网络对接）

---

### 6. 成本优化路由

**目标**：动态选择最低成本渠道

**功能点**：
- [ ] 费率配置管理
- [ ] 实时成本计算
- [ ] 成本路由规则
- [ ] 成本报表
- [ ] 异常费用检测

**数据模型**：
```sql
-- 扩展现有 provider_accounts.fee_config
fee_schedules             -- 费率表
cost_analytics            -- 成本分析
```

**工作量**：2-3 周

---

### 7. 风控规则引擎

**目标**：欺诈预防，减少拒付

**功能点**：
- [ ] 规则配置引擎
- [ ] 风险评分
- [ ] 黑名单/白名单
- [ ] 金额阈值
- [ ] 频率限制
- [ ] 人工审核队列
- [ ] 第三方风控集成（可选）

**数据模型**：
```sql
fraud_rules               -- 风控规则
fraud_scores              -- 风险评分
fraud_alerts              -- 风险预警
payment_reviews           -- 人工审核
blocklists                -- 黑名单
```

**工作量**：3-4 周

---

### 8. 退款状态同步

**目标**：完整退款生命周期管理

**功能点**：
- [ ] 渠道退款状态查询
- [ ] Webhook 状态更新
- [ ] 退款失败处理
- [ ] 退款报表

**工作量**：1-2 周

---

## P2 - 增强功能（可以有）

> 差异化竞争力、高级场景

### 9. 分账支付（Split Payments）

**目标**：支持礼品卡+卡组合支付

**功能点**：
- [ ] 多支付方式组合
- [ ] 顺序授权
- [ ] 余额查询
- [ ] 失败回滚

**数据模型**：
```sql
split_payments            -- 分账记录
split_payment_items       -- 分账明细
```

**工作量**：2-3 周

---

### 10. Click to Pay

**目标**：一键支付体验

**功能点**：
- [ ] EMVCo 标准
- [ ] Passkeys 认证
- [ ] 统一 SDK
- [ ] 卡网络集成

**工作量**：4-6 周（需网络认证）

---

### 11. 订阅/周期扣款

**目标**：支持订阅业务

**功能点**：
- [ ] 订阅计划管理
- [ ] 自动扣款调度
- [ ] 失败重试
- [ ] 订阅状态机

**数据模型**：
```sql
subscriptions             -- 订阅
subscription_plans        -- 订阅计划
subscription_invoices     -- 订阅发票
```

**工作量**：3-4 周

---

### 12. L2/L3 数据

**目标**：企业卡降低交换费

**功能点**：
- [ ] L2/L3 数据字段
- [ ] 数据校验
- [ ] 发票关联

**工作量**：1-2 周

---

### 13. 双标卡路由

**目标**：自动选择最优网络

**功能点**：
- [ ] 双标卡识别
- [ ] 网络优选逻辑
- [ ] 路由记录

**工作量**：1-2 周

---

## P3 - 渠道扩展

### 14. 完善现有渠道

- [ ] Square 完整实现
- [ ] Braintree 完整实现

**工作量**：各 2-3 周

---

### 15. 新增渠道

**优先级**：
1. Adyen - 全球覆盖
2. PayPal - 高渗透率
3. Checkout.com - 欧洲
4. Worldpay - 美国
5. 支付宝/微信支付 - 中国

**工作量**：每渠道 2-4 周

---

## P4 - 基础设施

### 16. 监控告警体系

- [ ] Prometheus 指标
- [ ] Grafana 看板
- [ ] 告警规则
- [ ] 日志聚合

**工作量**：2 周

---

### 17. 测试覆盖

- [ ] 单元测试
- [ ] 集成测试
- [ ] E2E 测试
- [ ] 性能测试

**工作量**：持续

---

### 18. 文档完善

- [ ] API 文档（OpenAPI）
- [ ] 架构文档
- [ ] 运维手册
- [ ] 故障排查指南

**工作量**：持续

---

## 实施计划

### Q1 - 基础能力 ✅

| 阶段 | 内容 | 周数 | 状态 |
|------|------|------|------|
| 第1-3周 | 渠道健康监控 + 自动降级 | 3 | ✅ 完成（含延迟分位数与趋势）|
| 第4-7周 | 智能重试引擎 | 4 | ✅ 完成（含 BIN 路由与 3DS 升级）|
| 第8-11周 | 对账系统 | 4 | ✅ 完成（含 PSP 自动拉取 / 银行结算 / 历史回溯）|

### Q2 - 合规与安全

| 阶段 | 内容 | 周数 |
|------|------|------|
| 第1-4周 | 3DS 完整流程 | ✅ 4（含 1.0 / frictionless / 责任转移）|
| 第5-8周 | 风控规则引擎 | 4 |
| 第9-10周 | 退款状态同步 | 2 |

### Q3 - 优化与扩展

| 阶段 | 内容 | 周数 |
|------|------|------|
| 第1-3周 | 成本优化路由 | 3 |
| 第4-8周 | 网络令牌化 | 5 |
| 第9-12周 | 渠道扩展（Adyen/PayPal） | 4 |

### Q4 - 高级功能

| 阶段 | 内容 | 周数 |
|------|------|------|
| 第1-3周 | 分账支付 | 3 |
| 第4-7周 | 订阅支付 | 4 |
| 第8-12周 | Click to Pay | 5 |

---

## 资源需求

| 角色 | 人数 | 周期 |
|------|------|------|
| 后端工程师 | 2-3 | 持续 |
| 前端工程师 | 1-2 | 按需 |
| DevOps | 1 | 持续 |
| 测试工程师 | 1 | 持续 |
| 产品经理 | 1 | 持续 |

---

## 风险与依赖

| 风险 | 缓解措施 |
|------|----------|
| 卡网络认证周期长 | 提前申请，并行开发 |
| 渠道对接复杂度高 | 抽象 Connector 层，统一接口 |
| 对账数据格式不统一 | 建立标准化转换层 |
| 3DS 合规要求 | 参考 EMVCo 规范，使用认证 SDK |
| 调度器多实例重复执行 | 引入分布式锁（待 P4 基建阶段补） |

---

## 成功指标

| 指标 | 当前 | 目标 | P0 完成后 |
|------|------|------|-----------|
| 支付成功率 | - | 95%+ | ✅ 预计 90%+（BIN 路由 + 3DS 升级）|
| 重试恢复率 | 0% | 20%+ | ✅ 基础能力 + BIN 智能 + 3DS 升级 |
| 对账自动化率 | 0% | 90%+ | ✅ PSP 自动拉取 + 银行结算自动匹配 |
| 渠道可用性 | - | 99.9% | ✅ 自动降级 + 真实延迟监控（p95/p99）|
| 欺诈率 | - | <0.1% | 待风控引擎 |
| 退款处理时效 | - | T+1 | 待完善 |

---

## P0 完成总结

**已实现功能（全部 4 大模块闭环）**：
- ✅ 智能重试引擎：立即重试 + 延迟重试 + BIN 路由 + 3DS 升级重试
- ✅ 拒绝码解析与分类：15 种 Stripe 错误码
- ✅ 渠道健康监控：错误率阈值 + 真实延迟 p95/p99 + 自动降级 + 历史趋势
- ✅ 对账系统：三方对账 + PSP 自动拉取（Stripe） + 银行结算导入 + 历史回溯
- ✅ 3DS 认证：2.x 会话/挑战 + 1.0 redirect + frictionless + 责任转移记录

**代码统计**：
- 新增/修改文件：~15 个服务与路由文件
- 新增代码：~3500 行（P0 补齐 +3500，相比 P0 初始 +2500）
- 数据库迁移：3 个（001 初版 / 002 retry & reconciliation / 003 p0_completion）
- 数据库新表：18 张

**Scheduler 周期任务**：
- 重试执行：每 1 分钟
- 健康检查：每 5 分钟
- PSP 自动拉取：每 15 分钟
- 结算新鲜度检查：每 6 小时

**待 P1 启动前解决**：
- 调度器单点：引入分布式锁（推荐 `node-cron` + Redis 或 `pg_advisory_lock`）
- `provider-dispatcher` 策略化重构：为 P3 渠道扩展铺路
- 测试基线：至少补 retry / reconciliation / 3DS 核心集成测试
