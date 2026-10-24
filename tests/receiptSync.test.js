const assert = require("assert");
const fs = require("fs"), path = require("path"), crypto = require("crypto");
const { createReceiptSync, dayRange } = require(process.argv[2] || "../modules/receiptSync");

const work = fs.mkdtempSync(path.join(__dirname, "run-"));
const baseDir = path.join(work, "fileuploads");
let idn = 0; const newId = () => "id" + (++idn);

// ---- in-memory DB ----
const shops = ["S1","S2","S3","S4","S5"].map(s => ({ shopid: s, status: true, shoptype: "Food" }));
const receipts = []; // {receiptid, ordernumber, shopid, create_at, totalprice, receiptdiscount, sync_status, sync_attempts}
const logsTbl = [];
const ts = (y,m,d,h,mi=0,s=0) => Math.floor(new Date(y,m-1,d,h,mi,s).getTime()/1000);
function addReceipts(y,m,d){ for(const sh of shops) for(let i=0;i<20;i++) receipts.push({ receiptid:`${sh.shopid}-${y}${m}${d}-${i}`, ordernumber:`O-${sh.shopid}-${d}-${i}`, shopid:sh.shopid, create_at: ts(y,m,d, i===0?0:(i===19?23:10), i===19?59:0, i===19?59:0), totalprice:100, receiptdiscount:10, sync_status:0, sync_attempts:0 }); }
const repo = {
  async fetchPendingReceipts(before){ return receipts.filter(r=>[0,2].includes(r.sync_status)&&r.create_at<before).map(r=>({receiptid:r.receiptid,create_at:r.create_at,shopid:r.shopid})); },
  async fetchActiveShopIds(){ return shops.filter(s=>s.status).map(s=>s.shopid); },
  async fetchReceiptsForShopDay(shopid,a,b){ return receipts.filter(r=>r.shopid===shopid&&r.create_at>=a&&r.create_at<b).map(r=>({...r, shoptype:"Food"})); },
  async markSynced(ids,obj,at){ for(const r of receipts) if(ids.includes(r.receiptid)) Object.assign(r,{sync_status:1,sync_file:obj,sync_at:at,sync_error:null}); },
  async markFailed(ids,err){ for(const r of receipts) if(ids.includes(r.receiptid)&&r.sync_status!==1) Object.assign(r,{sync_status:2,sync_error:err,sync_attempts:r.sync_attempts+1}); },
  async insertLogs(rows){ logsTbl.push(...rows); },
  async hasLogForDate(d){ return logsTbl.some(l=>l.sync_date===d); },
  async fetchSyncRows(a,b){ return receipts.filter(r=>r.create_at>=a&&r.create_at<b); },
};
// ---- fake MinIO ----
const remote = new Map(); let failFor = null; let putCount = 0;
const md5 = b => crypto.createHash("md5").update(b).digest("hex");
const storage = {
  async stat(n){ const b = remote.get(n); return b ? { size: b.length, etag: `"${md5(b)}"` } : null; },
  async put(n,p){ putCount++; if(failFor && failFor.test(n)) throw new Error("connection reset"); remote.set(n, fs.readFileSync(p)); },
};
const writeCsv = async (p, header, recs) => { fs.writeFileSync(p, [header.map(h=>h.title).join(","), ...recs.map(r=>header.map(h=>r[h.id]).join(","))].join("\n")+"\n"); };
const quiet = { log(){}, warn(){} };
let clock = new Date(2026,9,24,0,5);
const sync = createReceiptSync({ repo, storage, writeCsv, baseDir, remotePrefix:"import/offline-sales", newId, now:()=>clock, logger: quiet });
const count = s => receipts.filter(r=>r.sync_status===s).length;

(async () => {
  // dayRange covers 00:00:00 .. 23:59:59
  const r = dayRange("2026-10-23"); assert.equal(r.end - r.start, 86400);

  // ---- Run 1: 100 receipts on 23rd, S5 upload keeps failing -> 80 ok / 20 failed
  addReceipts(2026,10,23);
  failFor = /S5-/;
  let s = await sync.runDailySync();
  assert.equal(count(1), 80); assert.equal(count(2), 20);
  assert.equal(s.receiptsSynced, 80); assert.equal(s.receiptsFailed, 20);
  assert.ok(fs.existsSync(path.join(baseDir,"2026-10-23")), "folder kept when incomplete");
  assert.ok(remote.has("import/offline-sales/S1-2026-10-23.csv"));
  assert.ok(!remote.has("import/offline-sales/S5-2026-10-23.csv"));
  // records at 00:00:00 and 23:59:59 included (old code missed them)
  assert.ok(remote.get("import/offline-sales/S1-2026-10-23.csv").toString().split("\n").filter(Boolean).length === 21);
  console.log("run1 ok:", JSON.stringify({synced:count(1), failed:count(2), folders:s.folders}));

  // ---- Hourly retry 01:30: MinIO still failing -> still 20 pending
  clock = new Date(2026,9,24,1,30);
  s = await sync.runPendingRetry();
  assert.equal(s.mode, "retry"); assert.equal(s.complete, false); assert.equal(s.pendingRemaining, 20);
  assert.equal(count(1), 80, "retry must not touch already-success shops");
  // ---- 02:30: MinIO back -> complete, completedAt = 02:30
  failFor = null; clock = new Date(2026,9,24,2,30); putCount = 0;
  s = await sync.runPendingRetry();
  assert.equal(s.complete, true); assert.equal(s.completedAt, "2026-10-24T02:30:00+07:00");
  assert.equal(putCount, 1, "retry uploads only the missing S5 file");
  let st = await sync.getStatus();
  assert.equal(st.allComplete, true); assert.equal(st.days[0].date, "2026-10-23");
  assert.equal(st.days[0].completedAt, "2026-10-24T02:30:00+07:00");
  console.log("retry ok:", JSON.stringify(st.days[0]));
  // ---- 03:30: nothing pending -> skipped (no DB writes / uploads)
  clock = new Date(2026,9,24,3,30); putCount = 0;
  s = await sync.runPendingRetry();
  assert.equal(s.skipped, true); assert.equal(putCount, 0);
  failFor = /S5-/; // restore scenario for run 2 below: S5-23 already ok now, so make run2 test independent
  receipts.filter(r=>r.shopid==="S5"&&r.create_at<ts(2026,10,24,0)).forEach(r=>r.sync_status=2);
  remote.delete("import/offline-sales/S5-2026-10-23.csv");

  // ---- Run 2 next night: MinIO healthy. Sweep 23rd (S5) first, then 24th
  failFor = null; addReceipts(2026,10,24); clock = new Date(2026,9,25,0,5);
  putCount = 0;
  s = await sync.runDailySync();
  assert.deepEqual(s.sweptDates, ["2026-10-23"]);
  assert.equal(count(0)+count(2), 0, "all receipts success");
  assert.ok(remote.has("import/offline-sales/S5-2026-10-23.csv"));
  assert.ok(!fs.existsSync(path.join(baseDir,"2026-10-23")) && !fs.existsSync(path.join(baseDir,"2026-10-24")), "local folders deleted");
  assert.equal(putCount, 6, "only S5-23 + 5 files of 24th uploaded");
  console.log("run2 ok:", JSON.stringify({ swept:s.sweptDates, uploaded:s.uploaded, already:s.alreadyInMinio }));

  // ---- Leftover folder: one file identical in MinIO, one missing, one partial/corrupt
  const lf = path.join(baseDir,"2025-11-05"); fs.mkdirSync(lf,{recursive:true});
  for (const f of ["A","B","C"]) fs.writeFileSync(path.join(lf,`${f}-2025-11-05.csv`), `OrderNumber\n${f}1\n${f}2\n`);
  remote.set("import/offline-sales/A-2025-11-05.csv", fs.readFileSync(path.join(lf,"A-2025-11-05.csv")));
  remote.set("import/offline-sales/C-2025-11-05.csv", Buffer.from("OrderNumber\nC1\n"));
  putCount = 0;
  const out = await sync.reconcileLeftovers();
  assert.equal(putCount, 2); assert.ok(!fs.existsSync(lf));
  assert.equal(remote.get("import/offline-sales/C-2025-11-05.csv").toString(), "OrderNumber\nC1\nC2\n");
  console.log("leftover ok:", JSON.stringify(out));

  // ---- Upload that "succeeds" but object incomplete -> must be FAILED, folder kept
  const bad = { ...storage, async put(n,p){ remote.set(n, fs.readFileSync(p).subarray(0,5)); } };
  const sync2 = createReceiptSync({ repo, storage: bad, writeCsv, baseDir, newId, now:()=>clock, logger: quiet });
  const lf2 = path.join(baseDir,"2025-11-06"); fs.mkdirSync(lf2,{recursive:true}); fs.writeFileSync(path.join(lf2,"X.csv"),"OrderNumber\nX1\n");
  const o2 = await sync2.reconcileLeftovers();
  assert.equal(o2[0].failed.length, 1); assert.ok(fs.existsSync(lf2));
  console.log("verify-mismatch ok:", o2[0].failed[0].error);
  // ---- Retry when the daily run never happened (server down at 00:05) -> runs daily instead
  clock = new Date(2026,9,27,9,30); addReceipts(2026,10,26);
  s = await sync.runPendingRetry();
  assert.equal(s.mode, "daily"); assert.equal(s.complete, true);
  console.log("missed-daily ok:", s.completedAt);
  console.log("log rows:", logsTbl.length, "failed rows:", logsTbl.filter(l=>l.status==="FAILED").length);
  fs.rmSync(work,{recursive:true,force:true});
  console.log("ALL TESTS PASSED");
})().catch(e => { console.error(e); process.exit(1); });
