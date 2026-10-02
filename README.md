# 失物招领候选匹配与认领核对后端

本地运行的失物招领服务：登记遗失/拾获记录，按**公开、固定、可解释**的规则生成候选匹配，逐项说明加分、扣分或信息缺失，最终由人工显式确认归还。

- 技术栈：TypeScript + Node.js（内置 `node:sqlite`，**无需安装数据库或任何原生模块**）
- 只有 HTTP API 与命令行 CLI，不含前端
- 不采集真实证件（仅匿名联系人编号）、不做图片识别、不用语义模型、不访问在线服务
- 数据保存在项目内 `data/` 目录（SQLite 文件）

## 环境要求

- Windows + Node.js **22.5 及以上**（开发实测 Node 25；内置 `node:sqlite`）
- 无需 Docker、WSL 或网络。运行时会出现一次 `ExperimentalWarning: SQLite ...`，可忽略。

## 快速开始（PowerShell）

```powershell
npm install        # 安装 TypeScript/tsx（仅开发依赖）
npm run build      # 编译到 dist/
npm test           # 运行全部测试（固定规则顺序、边界、竞争、持久化等 14 项）
npm start          # 启动 HTTP 服务，默认由系统分配空闲端口，启动后打印端口
npm run demo       # 一键 CLI 演示：登记→候选→解释→拒绝→确认→重复确认→导出
```

可用环境变量：

- `PORT`：HTTP 端口，默认 `0`（系统自动选择空闲端口），如 `$env:PORT=8080`
- `DB_PATH`：SQLite 文件路径，默认 `./data/lostfound.db`
- `DB_DIR`：仅 CLI 使用，默认 `./data`

## 匹配规则（固定且公开，代码见 `src/matching.ts`）

候选**只是建议**，不会自动归还。规则如下：

1. **类别硬门槛**：类别不同直接排除，不进入候选、不出解释（错误码 `CATEGORY_CONFLICT`）。
2. **时间（±35）**：遗失日期区间与拾获日期区间**有交集 +35**（区间首尾当天相接也算交集）；无交集时按最近间隔扣分：相差 1–2 天 −6，3–7 天 −12，更远 −20；任一侧日期缺失记“信息缺失”，**0 分**。
3. **地点（−10 ~ +25）**：具体地点完全一致 **+25**；仅同一 `area` 但具体地点不同 **+8（partial）**；连区域都不同 **−10**；地点缺失 0 分。
4. **颜色（−10 ~ +21）**：颜色集合每命中一种 +7，上限 +21；双方都填但无交集 −10；一侧未填记缺失，0 分。
5. **特征标签（−6 ~ +24）**：每命中一个标签 +8，上限 +24；双方都有标签但零命中 −6；一侧无标签记缺失，0 分。
6. **名称不计分**：物品名称（如两串都叫“一串钥匙”）**本身不产生任何加分**，只用于人工展示，避免“同名即同物”。

- 候选门槛：总分 **≥ 20** 才列入候选。
- 排序：总分降序；**同分按 `(lostId, foundId)` 字典序**，次序稳定，与插入顺序无关。
- 任何维度信息缺失都会附带警告：**缺失不等于相符**，归还前必须人工核对。

### 演示数据如何体现区别（`src/seed.ts`）

| 场景 | 记录 | 说明 |
| --- | --- | --- |
| 同名不同地点 | `L-SEED-001` 图书馆钥匙 vs `F-SEED-002` 食堂钥匙 | 名称相同，但地点/颜色/标签均不符，仅 9 分，不进候选 |
| 近似特征 | `L-SEED-001` vs `F-SEED-001` | 同地点、日期相接、颜色/标签部分命中，83 分，排第一 |
| 资料不全 | `L-SEED-002` vs `F-SEED-003`（雨伞，颜色缺失） | 颜色维度 `missing` 0 分，并给出警告 |
| 仅同区域 | `L-SEED-003` vs `F-SEED-004`（背包） | 地点 +8（partial），区别于完全一致 +25 |
| 已归还 | `L-SEED-004` / `F-SEED-005`（钱包） | 演示确认后变 `returned`，不再参与候选，禁止重复归还 |

## HTTP API

响应为 JSON；错误形如 `{"error":{"code":"...","message":"..."}}`。服务监听 `127.0.0.1`。

| 方法 | 路径 | 说明 |
| --- | --- | --- |
| GET | `/health` | 健康检查 |
| GET | `/records?kind=lost\|found` | 列出记录 |
| POST | `/records` | 登记记录 |
| GET | `/records/:id` | 查看单条 |
| PATCH/PUT | `/records/:id` | 修改开放记录（提交完整字段，服务端合并校验）；版本号 +1，候选随后重算 |
| POST | `/records/:id/close` | 关闭记录（需 `reason`），默认不再参与候选 |
| GET | `/candidates?lostId=&foundId=&includeClosed=true` | 生成候选列表（默认仅 open 记录） |
| GET | `/explain?lostId=&foundId=` | 查看单对配对的逐项解释（类别冲突返回 422） |
| POST | `/returns` | **人工确认归还**（必须 `confirm:true`） |
| GET | `/returns` | 归还/核对历史（含确认时的双方快照与分数） |

登记请求示例：

```json
{
  "kind": "found",
  "category": "keys",
  "itemName": "一串钥匙",
  "colors": ["silver", "yellow"],
  "tags": ["卡通挂件", "三把"],
  "area": "中央图书馆",
  "location": "中央图书馆 三楼自习区",
  "dateFrom": "2026-09-26",
  "dateTo": "2026-09-26",
  "contactCode": "ANON-F-001",
  "description": "可选备注"
}
```

确认归还请求示例：

```json
{ "lostId": "L-SEED-004", "foundId": "F-SEED-005", "reason": "现场核对拉链与外观一致，匿名编号互认", "operator": "clerk-zhang", "confirm": true }
```

## 错误码

| 错误码 | HTTP | 含义 |
| --- | --- | --- |
| `INVALID_BODY` / `INVALID_JSON` | 400 | 请求体不是合法 JSON 对象 |
| `INVALID_FIELD` | 400 | 字段缺失/过长/取值非法（含 kind 非 lost/found） |
| `INVALID_CATEGORY` | 400 | 类别不在允许列表 |
| `INVALID_DATE` / `INVALID_DATE_RANGE` | 400 | 日期格式或日历值非法 / 起止颠倒 |
| `INVALID_CONTACT` | 400 | 匿名编号不符合 3–32 位字母数字 `_` `-` |
| `INVALID_ID` | 400 | 记录编号格式非法 |
| `NOT_FOUND` | 404 | 记录或路由不存在 |
| `CATEGORY_CONFLICT` | 422 | 类别明显冲突，不能配对/确认 |
| `CONFIRM_REQUIRED` | 409 | 未显式 `confirm:true` |
| `ALREADY_RETURNED` | 409 | 一方或双方已归还，禁止重复归还/修改 |
| `ALREADY_CLOSED` | 409 | 记录已关闭 |
| `RACE_CONFLICT` | 409 | 并发竞争（事务内复查或唯一约束冲突） |
| `BODY_TOO_LARGE` | 413 | 请求体超过 1MB |

## 一致性保证

- 确认归还在单个 SQLite 事务（`BEGIN IMMEDIATE`）内完成：插入归还事件 + 双方状态改 `returned`，任一步失败全部回滚（**核对失败，双方状态不变**）。
- `returns` 表对 `lost_id`、`found_id` 各有唯一约束：同一遗失记录只能归还一次，同一拾获物也不能被第二次成功匹配/认领。
- 归还事件保存**确认当时**的双方完整快照、当时得分和操作原因；之后修改开放记录只影响新候选，不改动历史。
- 已归还记录禁止修改/关闭；状态为 `open / closed / returned`。

## CLI 示例

```powershell
npm run cli -- seed
npm run cli -- list --kind found
npm run cli -- candidates
npm run cli -- explain --lostId L-SEED-001 --foundId F-SEED-002
npm run cli -- add --kind found --category umbrella --itemName 折叠伞 --colors blue `
  --tags 木柄 --area 教学楼A --location "教学楼A 二层" `
  --dateFrom 2026-09-29 --dateTo 2026-09-29 --contactCode ANON-F-100
npm run cli -- update --id F-SEED-001 --tags 卡通挂件,三把,门禁卡,红色挂绳
npm run cli -- close --id F-SEED-002 --reason "无人认领，移交保卫处"
npm run cli -- confirm --lostId L-SEED-004 --foundId F-SEED-005 `
  --reason "匿名编号互认，现场核对一致" --operator clerk-li --confirm true
npm run cli -- returns --export data/checks.json
```

类别允许值：`keys(钥匙)`、`umbrella(雨伞)`、`backpack(背包)`、`phone(手机)`、`wallet(钱包)`、`card(卡片)`、`other(其他)`（中英文均可）。

## 项目结构

```
src/
  types.ts       数据模型与 AppError
  validation.ts  参数校验、类别/日期/匿名编号规则
  db.ts          SQLite 建表、CRUD、归还事件、行映射
  matching.ts    固定评分规则、解释、候选生成与稳定排序
  service.ts     业务逻辑与归还事务（竞争复查、状态机）
  server.ts      零依赖 HTTP API、错误码、端口选择
  cli.ts         命令行与一键演示
  seed.ts        虚构演示数据
test/            规则与 API 测试（node:test）
data/            SQLite 与导出文件目录（运行时生成）
```

## 已知限制与合理假设

- 候选阈值 20、分值与权重是本服务的固定设计决策，不提供通用规则引擎；改动需同步更新 README 与测试。
- 地点采用“区域 + 具体地点”两级文本精确匹配，不做地理距离计算或同名地点消歧。
- 不设用户/认证体系；`operator` 仅为操作员工号字符串，用于审计留痕。
- `node:sqlite` 在当前 Node 版本标记为实验性，API 未来版本可能变化（本项目锁定其同步 `DatabaseSync` 基础用法）。
