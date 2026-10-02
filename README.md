# 失物招领候选匹配与认领核对后端（本地演示）

使用 **TypeScript + Node.js + SQLite** 实现的纯本地失物招领服务，只提供 **HTTP API 与 CLI**，无前端。
所有演示数据均为**虚构**；系统不采集真实证件、不做图片识别、不使用语义模型、不做在线寻人。

## 功能概览

- 分别登记**遗失记录**与**拾获记录**：物品类别、颜色、特征标签、地点（具体地点 + 区域）、日期范围、匿名联系人编号、描述。
- 为某条记录生成**候选匹配**，并对每一对记录给出**逐项可解释的匹配依据**（加分 / 扣分 / 信息缺失）。
- **人工确认归还**：必须指定一对记录并显式 `confirm=true`，候选永远只是建议。
- 归还事件持久化保存**当时双方记录快照与操作原因**，事后修改描述不影响历史。
- 导出核对记录（JSON / CSV）。
- 已归还的拾获物不再进入候选；同一遗失记录不能重复归还；双方状态在同一事务中提交，冲突返回 `CONFLICT`。

## 环境要求

- Windows 本地，Node.js **>= 22**（使用内置 `node:sqlite`，无需原生编译、Docker、WSL 或任何外部服务）。
- 本项目开发验证环境：Node.js v25。

## 常用命令

    npm install        # 安装开发依赖（typescript、@types/node）
    npm run build      # 编译 TypeScript 到 dist/
    npm test           # 构建并运行全部测试（node:test）
    npm run seed       # 写入虚构演示数据（钥匙、雨伞、背包、钱包等）
    npm start          # 启动 HTTP 服务，默认自动选择空闲端口
    node dist/src/api.js --port 8080   # 指定端口；也可用环境变量 PORT
    npm run cli -- list                # CLI（见下）

数据保存在项目内 `data/lostfound.db`（可用环境变量 `LAF_DATA_DIR` 更换目录）。

## 匹配规则（固定规则，逐项解释）

候选只比较一条遗失记录与一条拾获记录。**同名 / 同类别不会自动认定为同一件物品**，只表示“不冲突”。

0. **类别**：两个已知且不同的具体类别（如 手机 vs 雨伞）视为**明显冲突，直接不进入候选**；类别一致、未知或「其他」不加分也不排除。
1. **地点**：具体地点完全一致 **+30**；仅同一区域（area 相同但具体地点不同或缺失）**+15**；都不同 +0；信息缺失 +0 并注明“信息缺失”。
2. **日期**：遗失日期范围与拾获日期范围有重叠 **+20**；间隔 ≤ 2 天 **+10**；更远 +0；缺日期 +0 并注明。
3. **颜色**：完全一致 **+15**；同色系（如 藏青/蓝）**+8**；明确不同色系 **-10**；缺颜色 +0 并注明。
4. **标签**：每个共同特征标签 **+5**，封顶 **+20**；任一方无标签 +0 并注明。

- **候选门槛**：总分 **>= 25** 才进入候选列表。
- **稳定次序**：总分降序；同分按对方记录 id 升序。
- **缺少信息一律不当作相符**（+0 并在解释中注明），地点完全一致与同区域明确区分。

## HTTP API

错误统一返回 `{ "error": { "code", "message" } }`，错误码：`VALIDATION_ERROR`(400)、`NOT_FOUND`(404)、`BAD_STATE`(409)、`CONFLICT`(409)、`INTERNAL`(500)。

- `GET  /health` 健康检查
- `POST /records` 登记记录（字段见下）
- `GET  /records?type=&status=` 列表（type: lost/found；status: open/closed/returned）
- `GET  /records/:id` 查看单条
- `PATCH /records/:id` 修改（仅 open 状态；修改后候选重新计算）
- `POST /records/:id/close` 关闭记录
- `GET  /records/:id/candidates` 生成候选（含逐项解释）
- `GET  /explain?lostId=&foundId=` 查看任意一对记录的匹配依据
- `POST /returns` 确认归还：`{"lostId":1,"foundId":2,"reason":"...","confirm":true}`
- `GET  /returns` 归还历史（含双方快照与原因）
- `GET  /export/returns?format=json|csv` 导出核对记录

登记字段（`POST /records`）：

    {
      "type": "lost | found",        // 必填
      "category": "雨伞",            // 必填
      "color": "黑",                 // 可空
      "tags": ["长柄", "弯柄"],       // 可空，字符串数组
      "place": "图书馆二楼阅览室",     // 可空，具体地点
      "area": "图书馆",              // 可空，区域
      "dateFrom": "2026-09-10",      // 可空，YYYY-MM-DD
      "dateTo": "2026-09-10",        // 可空，不早于 dateFrom
      "contactCode": "L-1001",       // 必填，匿名联系人编号（非真实证件）
      "description": "..."           // 可空
    }

## CLI

    node dist/src/cli.js seed
    node dist/src/cli.js add --json "{\"type\":\"lost\",\"category\":\"钥匙\",\"contactCode\":\"L-9\"}"
    node dist/src/cli.js update --id 3 --json "{\"color\":\"黑\"}"
    node dist/src/cli.js close --id 3
    node dist/src/cli.js list --type found --status open
    node dist/src/cli.js candidates --id 1
    node dist/src/cli.js explain --lost 1 --found 2
    node dist/src/cli.js confirm --lost 1 --found 2 --reason "现场核对特征一致" --confirm true
    node dist/src/cli.js returns
    node dist/src/cli.js export --format csv

## 演示数据（npm run seed，全部虚构）

- **同名不同地点**：两把“黑色雨伞”，一把在图书馆（地点完全一致，高分候选），一把在食堂（地点不同，低分）。
- **近似特征**：两串钥匙标签部分重合；另有一把“单把金色钥匙”颜色扣分、标签不符，体现区分度。
- **资料不全**：遗失背包缺颜色和日期，解释中明确标注“信息缺失”，不会当作相符。
- **类别冲突**：遗失手机 vs 拾获雨伞，不进入候选。
- **已归还**：一对钱包记录已确认归还，之后不再出现在候选中，归还历史可查询。

## 测试

`npm test` 运行 14 个用例，覆盖：固定规则下的候选顺序与逐项解释、日期边界（端点相接 / 间隔 2 天 / 3 天）、缺字段、重复确认、两次认领竞争（CONFLICT 且双方状态不变）、错误输入校验、已归还记录不再匹配、修改后重新计算候选、重启后归还历史持久化、CSV 导出。

## 限制与假设

- 单进程本地服务；并发冲突依靠 SQLite 事务（BEGIN IMMEDIATE）与事务内状态复查，多实例同时写同一数据库未做额外协调。
- 类别、色系、标签均为字符串精确匹配（颜色按内置色系表归类），无同义词词典与语义模型。
- 无用户系统与权限控制，匿名联系人编号仅为演示字段。
- `node:sqlite` 在 Node 25 仍标记为 experimental，启动时会有提示警告，不影响功能。
