import { Service } from "./service";
import { seed } from "./seed";

function argValue(args: string[], name: string): string | undefined {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
}

function parseBody(args: string[]): any {
  const json = argValue(args, "json");
  if (!json) throw new Error("缺少 --json '<JSON>' 参数");
  return JSON.parse(json);
}

function print(obj: unknown): void {
  console.log(JSON.stringify(obj, null, 2));
}

const USAGE = `失物招领 CLI（本地虚构数据演示）
用法: node dist/src/cli.js <命令> [参数]
命令:
  seed                                  写入演示数据
  add --json '<RecordInput>'            登记记录
  update --id N --json '<部分字段>'      修改记录（仅 open 状态）
  close --id N                          关闭记录
  list [--type lost|found] [--status open|closed|returned]
  get --id N                            查看记录
  candidates --id N                     生成候选（含逐项解释）
  explain --lost N --found M            查看两条记录的匹配依据
  confirm --lost N --found M --reason "..." --confirm true
  returns                               查看归还历史
  export [--format json|csv]            导出核对记录
`;

function main(): void {
  const args = process.argv.slice(2);
  const cmd = args[0];
  const service = new Service();
  switch (cmd) {
    case "seed":
      seed(service);
      console.log("演示数据已写入");
      break;
    case "add":
      print(service.createRecord(parseBody(args)));
      break;
    case "update":
      print(service.updateRecord(Number(argValue(args, "id")), parseBody(args)));
      break;
    case "close":
      print(service.closeRecord(Number(argValue(args, "id"))));
      break;
    case "list":
      print(
        service.listRecords({
          type: argValue(args, "type"),
          status: argValue(args, "status"),
        })
      );
      break;
    case "get":
      print(service.getRecord(Number(argValue(args, "id"))));
      break;
    case "candidates":
      print(service.candidatesFor(Number(argValue(args, "id"))));
      break;
    case "explain":
      print(service.explain(Number(argValue(args, "lost")), Number(argValue(args, "found"))));
      break;
    case "confirm":
      print(
        service.confirmReturn(
          Number(argValue(args, "lost")),
          Number(argValue(args, "found")),
          argValue(args, "reason") ?? "",
          argValue(args, "confirm") === "true"
        )
      );
      break;
    case "returns":
      print(service.listReturns());
      break;
    case "export": {
      const format = argValue(args, "format") ?? "json";
      if (format === "csv") console.log(service.exportReturnsCsv());
      else print(service.listReturns());
      break;
    }
    default:
      process.stdout.write(USAGE);
      if (cmd) process.exitCode = 1;
  }
}

try {
  main();
} catch (e: any) {
  const code = e?.code ? `[${e.code}] ` : "";
  console.error(`错误: ${code}${e.message}`);
  process.exitCode = 1;
}
