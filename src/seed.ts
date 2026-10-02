import { Service } from "./service";

// 演示数据：全部为虚构，包含同名不同地点、近似特征、资料不全、已归还等情形
export function seed(service: Service): void {
  const s = service;

  // 1) 同名不同地点：两把“黑色雨伞”
  s.createRecord({
    type: "lost", category: "雨伞", color: "黑", tags: ["长柄", "弯柄"],
    place: "图书馆二楼阅览室", area: "图书馆", dateFrom: "2026-09-10", dateTo: "2026-09-10",
    contactCode: "L-1001", description: "黑色长柄雨伞，伞柄有划痕",
  });
  s.createRecord({
    type: "found", category: "雨伞", color: "黑", tags: ["长柄", "弯柄"],
    place: "图书馆二楼阅览室", area: "图书馆", dateFrom: "2026-09-10",
    contactCode: "F-2001", description: "在阅览室门口捡到黑色长柄伞",
  });
  s.createRecord({
    type: "found", category: "雨伞", color: "黑", tags: ["折叠"],
    place: "食堂一层", area: "食堂", dateFrom: "2026-09-11",
    contactCode: "F-2002", description: "黑色折叠伞，食堂捡到",
  });

  // 2) 近似特征：钥匙串，标签部分重合、颜色同色系
  s.createRecord({
    type: "lost", category: "钥匙", color: "银", tags: ["钥匙串", "蓝色挂件", "三把钥匙"],
    place: "体育馆更衣室", area: "体育馆", dateFrom: "2026-09-12", dateTo: "2026-09-13",
    contactCode: "L-1002", description: "一串钥匙，挂蓝色小熊",
  });
  s.createRecord({
    type: "found", category: "钥匙", color: "银", tags: ["钥匙串", "蓝色挂件"],
    place: "体育馆前台", area: "体育馆", dateFrom: "2026-09-13",
    contactCode: "F-2003", description: "前台收到一串钥匙",
  });
  s.createRecord({
    type: "found", category: "钥匙", color: "金", tags: ["单把钥匙"],
    place: "体育馆前台", area: "体育馆", dateFrom: "2026-09-13",
    contactCode: "F-2004", description: "单独一把金色钥匙",
  });

  // 3) 资料不全：遗失背包缺少颜色和日期
  s.createRecord({
    type: "lost", category: "背包", tags: ["双肩包"],
    place: "教学楼A座", area: "教学区",
    contactCode: "L-1003", description: "遗失一个双肩背包，细节待补充",
  });
  s.createRecord({
    type: "found", category: "背包", color: "藏青", tags: ["双肩包", "有水杯侧袋"],
    place: "教学楼A座大厅", area: "教学区", dateFrom: "2026-09-15",
    contactCode: "F-2005", description: "藏青色双肩包",
  });

  // 4) 类别明显冲突：遗失手机 vs 拾获雨伞，不应成为候选
  s.createRecord({
    type: "lost", category: "手机", color: "白", tags: ["碎屏"],
    place: "食堂一层", area: "食堂", dateFrom: "2026-09-11", dateTo: "2026-09-11",
    contactCode: "L-1004", description: "白色手机，屏幕有裂痕",
  });

  // 5) 已归还：一对记录直接确认归还，之后不再出现在候选中
  const lostDone = s.createRecord({
    type: "lost", category: "钱包", color: "棕", tags: ["皮质", "有校园卡"],
    place: "图书馆一楼大厅", area: "图书馆", dateFrom: "2026-09-08", dateTo: "2026-09-08",
    contactCode: "L-1005", description: "棕色皮钱包",
  });
  const foundDone = s.createRecord({
    type: "found", category: "钱包", color: "棕", tags: ["皮质", "有校园卡"],
    place: "图书馆一楼大厅", area: "图书馆", dateFrom: "2026-09-08",
    contactCode: "F-2006", description: "服务台收到棕色钱包",
  });
  s.confirmReturn(lostDone.id, foundDone.id, "失主现场核对校园卡与包内物品一致，工作人员确认归还", true);
}

if (require.main === module) {
  const service = new Service();
  seed(service);
  console.log("演示数据已写入（虚构数据）：");
  for (const r of service.listRecords()) {
    console.log(`  #${r.id} [${r.type}/${r.status}] ${r.category} ${r.color ?? "-"} @ ${r.place ?? "?"}`);
  }
  for (const ev of service.listReturns()) {
    console.log(`  归还事件 #${ev.id}: lost=${ev.lostId} found=${ev.foundId} 原因=${ev.reason}`);
  }
}
