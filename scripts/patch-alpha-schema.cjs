const fs = require("fs");
const path = require("path");
const p = path.join(__dirname, "..", "prisma", "schema.prisma");
let s = fs.readFileSync(p, "utf8").replace(/\r\n/g, "\n");
const insert = "/// Tri-Core Alpha Matrix persisted signals (single source of truth for dashboard + /api/trading/signals).\n" +
"model AlphaSignalRecord {\n" +
"  id                 String            @id @default(cuid())\n" +
"  symbol             String\n" +
"  timeframe          AlphaTimeframe\n" +
"  direction          AlphaDirection\n" +
"  entryPrice         Decimal           @db.Decimal(24, 8)\n" +
"  targetPrice        Decimal           @db.Decimal(24, 8)\n" +
"  stopLoss           Decimal           @db.Decimal(24, 8)\n" +
"  winProbability     Int\n" +
"  whaleConfirmation  Boolean           @default(false)\n" +
"  rationaleHebrew    String            @db.Text\n" +
"  status             AlphaSignalStatus @default(Active)\n" +
"  createdAt          DateTime          @default(now())\n" +
"  updatedAt          DateTime          @updatedAt\n" +
"  tradeExecutions    TradeExecution[]\n" +
"\n" +
"  @@index([status, createdAt(sort: Desc)])\n" +
"  @@index([symbol, timeframe, status])\n" +
"}\n" +
"\n" +
"enum AlphaTimeframe {\n" +
"  Hourly\n" +
"  Daily\n" +
"  Weekly\n" +
"  Long\n" +
"}\n" +
"\n" +
"enum AlphaDirection {\n" +
"  Long\n" +
"  Short\n" +
"}\n" +
"\n" +
"enum AlphaSignalStatus {\n" +
"  Active\n" +
"  Hit\n" +
"  Stopped\n" +
"  Expired\n" +
"}\n" +
"\n";
const oldBlock = "model TradeExecution {\n" +
"  id            String               @id @default(cuid())\n" +
"  symbol        String\n" +
"  alphaSignalId String?\n" +
"  type          TradeExecutionType\n" +
"  side          TradeSide\n" +
"  amount        Decimal              @db.Decimal(24, 8)\n" +
"  entryPrice    Decimal              @db.Decimal(24, 8)\n" +
"  exitPrice     Decimal?             @db.Decimal(24, 8)\n" +
"  pnl           Decimal?             @db.Decimal(24, 8)\n" +
"  status        TradeExecutionStatus @default(OPEN)\n" +
"  executedAt    DateTime             @default(now())\n" +
"  closedAt      DateTime?\n" +
"  insights      LearnedInsight[]\n" +
"\n" +
"  @@index([symbol, executedAt(sort: Desc)])\n" +
"  @@index([status, executedAt(sort: Desc)])\n" +
"}";
const newBlock = "model TradeExecution {\n" +
"  id            String               @id @default(cuid())\n" +
"  symbol        String\n" +
"  alphaSignalId String?\n" +
"  type          TradeExecutionType\n" +
"  side          TradeSide\n" +
"  amount        Decimal              @db.Decimal(24, 8)\n" +
"  entryPrice    Decimal              @db.Decimal(24, 8)\n" +
"  exitPrice     Decimal?             @db.Decimal(24, 8)\n" +
"  pnl           Decimal?             @db.Decimal(24, 8)\n" +
"  status        TradeExecutionStatus @default(OPEN)\n" +
"  executedAt    DateTime             @default(now())\n" +
"  closedAt      DateTime?\n" +
"  insights      LearnedInsight[]\n" +
"  alphaSignal   AlphaSignalRecord?     @relation(fields: [alphaSignalId], references: [id], onDelete: SetNull)\n" +
"\n" +
"  @@index([symbol, executedAt(sort: Desc)])\n" +
"  @@index([status, executedAt(sort: Desc)])\n" +
"}";
if (!s.includes("model AlphaSignalRecord")) {
  s = s.replace(
    "datasource db {\n  provider = \"postgresql\"\n}\n\nmodel TradeExecution {",
    "datasource db {\n  provider = \"postgresql\"\n}\n\n" + insert + "model TradeExecution {"
  );
}
if (s.includes("model AlphaSignalRecord") && !s.includes("alphaSignal   AlphaSignalRecord?")) {
  s = s.replace(oldBlock, newBlock);
}
fs.writeFileSync(p, s.replace(/\n/g, "\r\n"));
console.log("schema ok", s.includes("AlphaSignalRecord"));