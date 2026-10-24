// =====================================================================
// Receipt sync -> MinIO (import/offline-sales)
//
// ขั้นตอนต่อรอบ:
//   1. กวาด receipt ที่ยังไม่ success (sync_status 0/2) ของวันก่อนหน้าทั้งหมด  + ร้านที่ active ของเมื่อวาน
//   2. สร้าง CSV ต่อ ร้าน/วัน ใหม่ทั้งไฟล์ (ข้อมูลครบทั้งวัน -> อัปทับได้ไม่ซ้ำ)
//   3. ทุกไฟล์ใน fileuploads/<date>/ (รวมโฟลเดอร์ที่ค้างจากรอบก่อน) -> เช็คใน MinIO ก่อน
//        มีอยู่แล้วและตรงกัน (size + md5)  -> ข้าม
//        ไม่มี / ไม่ตรง                     -> อัปโหลด แล้วเช็คซ้ำ
//   4. ไฟล์ที่ยืนยันแล้ว -> flag receipt = 1 (success), ไม่ผ่าน -> flag = 2 (รอกวาดรอบหน้า)
//   5. ลบโฟลเดอร์ local เฉพาะเมื่อทุกไฟล์ในโฟลเดอร์ยืนยันใน MinIO แล้ว
//
// โมดูลนี้ไม่ require DB / MinIO ตรงๆ (รับ repo / storage เข้ามา) เพื่อให้ทดสอบได้
// =====================================================================
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_DIR = /^\d{4}-\d{2}-\d{2}$/;

const CSV_HEADER = [
  { id: "ordernumber", title: "OrderNumber" },
  { id: "type", title: "Type" },
  { id: "orderstatus", title: "OrderStatus" },
  { id: "create_at", title: "TransactionDate" },
  { id: "totalgrossamount", title: "TotalGrossAmount" },
  { id: "totalprice", title: "TotalNetAmount" },
  { id: "source", title: "Source" },
];

const pad = (n) => String(n).padStart(2, "0");
function fmtDate(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
function fmtDateTime(d) {
  return `${fmtDate(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}+07:00`;
}
function startOfDay(d) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 0, 0, 0, 0);
}
// ช่วงเวลาของวัน (epoch วินาที) แบบ [00:00:00, 00:00:00 ของวันถัดไป)
function dayRange(dateStr) {
  const [y, m, d] = dateStr.split("-").map(Number);
  const start = new Date(y, m - 1, d, 0, 0, 0, 0);
  const end = new Date(y, m - 1, d + 1, 0, 0, 0, 0);
  return { start: Math.floor(start.getTime() / 1000), end: Math.floor(end.getTime() / 1000) };
}

function toCsvRow(r) {
  return {
    ordernumber: r.ordernumber,
    type: r.shoptype,
    orderstatus: "COMPLETED",
    create_at: fmtDateTime(new Date(Number(r.create_at) * 1000)),
    totalgrossamount: Number(r.totalprice) + Number(r.receiptdiscount),
    totalprice: r.totalprice,
    source: "POS",
  };
}

async function fileFingerprint(filePath) {
  const buf = await fs.promises.readFile(filePath);
  return { size: buf.length, md5: crypto.createHash("md5").update(buf).digest("hex") };
}

// remote ตรงกับ local หรือไม่ (etag ที่มี "-" คือ multipart -> เทียบได้แค่ size)
function sameObject(local, remote) {
  if (!remote) return false;
  if (Number(remote.size) !== local.size) return false;
  const etag = String(remote.etag || "").replace(/"/g, "");
  if (etag && !etag.includes("-")) return etag === local.md5;
  return true;
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

/**
 * @param {object} o
 * @param {object} o.repo      ดู modules/receiptSyncRepo.js
 * @param {object} o.storage   { stat(objectName) -> {size, etag}|null, put(objectName, localPath) }
 * @param {Function} o.writeCsv (filePath, header, records) => Promise
 */
function createReceiptSync({
  repo,
  storage,
  writeCsv,
  baseDir = "./fileuploads",
  remotePrefix = "import/offline-sales",
  maxUploadAttempts = 3,
  newId,
  now = () => new Date(),
  logger = console,
}) {
  const objectNameOf = (fileName) => path.posix.join(remotePrefix, fileName);

  // ---------------------------------------------------------------
  // เช็ค 1 ไฟล์กับ MinIO -> อัปถ้ายังไม่มี/ไม่ครบ -> เช็คซ้ำ
  // ---------------------------------------------------------------
  async function ensureUploaded(localPath, objectName) {
    const local = await fileFingerprint(localPath);
    let lastError = null;

    try {
      if (sameObject(local, await storage.stat(objectName))) {
        return { ok: true, action: "ALREADY_IN_MINIO" };
      }
    } catch (e) {
      lastError = e; // stat ล้ม -> ลองอัปต่อ
    }

    for (let attempt = 1; attempt <= maxUploadAttempts; attempt++) {
      try {
        await storage.put(objectName, localPath);
        const remote = await storage.stat(objectName);
        if (sameObject(local, remote)) return { ok: true, action: "UPLOADED" };
        lastError = new Error(
          `verify mismatch (local ${local.size}B/${local.md5}, remote ${remote ? remote.size + "B/" + remote.etag : "missing"})`
        );
      } catch (e) {
        lastError = e;
      }
      logger.warn(`[receiptSync] upload attempt ${attempt}/${maxUploadAttempts} failed for ${objectName}: ${lastError.message}`);
    }
    return { ok: false, error: lastError ? lastError.message : "unknown error" };
  }

  // ---------------------------------------------------------------
  // เช็คทั้งโฟลเดอร์ -> คืนผลรายไฟล์ ; ลบโฟลเดอร์เมื่อครบทุกไฟล์ (ถ้า deleteWhenComplete)
  // ---------------------------------------------------------------
  async function reconcileFolder(folderPath, { deleteWhenComplete = true } = {}) {
    const entries = await fs.promises.readdir(folderPath, { withFileTypes: true });
    const results = [];
    for (const ent of entries) {
      if (!ent.isFile()) continue;
      const objectName = objectNameOf(ent.name);
      const r = await ensureUploaded(path.join(folderPath, ent.name), objectName);
      results.push({ file: ent.name, objectName, ...r });
    }
    const failed = results.filter((r) => !r.ok);
    let deleted = false;
    if (deleteWhenComplete && failed.length === 0) {
      await fs.promises.rm(folderPath, { recursive: true, force: true });
      deleted = true;
      logger.log(`[receiptSync] ${folderPath}: ${results.length} file(s) verified in MinIO -> local folder deleted`);
    } else if (failed.length) {
      logger.warn(`[receiptSync] ${folderPath}: ${failed.length}/${results.length} file(s) NOT in MinIO -> keep local folder for next run`);
    }
    return { folder: folderPath, results, deleted };
  }

  async function listDateFolders() {
    if (!fs.existsSync(baseDir)) return [];
    const entries = await fs.promises.readdir(baseDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && DATE_DIR.test(e.name))
      .map((e) => e.name)
      .sort();
  }

  // ---------------------------------------------------------------
  // รอบ sync หลัก (cron 00:05 / GET /uploadscsv)
  // ---------------------------------------------------------------
  // mode "daily": กวาดของค้าง + ทุกร้าน active ของเมื่อวาน
  // mode "retry": เฉพาะรายการที่ยังค้าง (status 0/2) + โฟลเดอร์ local ที่ค้าง
  async function runSync({ mode = "daily" } = {}) {
    const runId = newId();
    const today = startOfDay(now());
    const todayTs = Math.floor(today.getTime() / 1000);
    const yesterday = fmtDate(new Date(today.getTime() - DAY_MS / 2)); // กัน DST

    // 1) กวาด receipt ที่ยังไม่ success ทั้งหมดก่อนวันนี้
    const pending = await repo.fetchPendingReceipts(todayTs);
    const groups = new Map(); // date -> Set(shopid)
    let unmapped = 0;
    for (const p of pending) {
      if (!p.shopid) { unmapped++; continue; }
      const d = fmtDate(new Date(Number(p.create_at) * 1000));
      if (!groups.has(d)) groups.set(d, new Set());
      groups.get(d).add(p.shopid);
    }
    if (unmapped) logger.warn(`[receiptSync] ${unmapped} pending receipt(s) have no matching order/shop -> skipped`);

    const sweptDates = [...groups.keys()].filter((d) => d !== yesterday).sort();
    if (sweptDates.length) {
      logger.log(`[receiptSync] sweep: re-sync pending receipts from ${sweptDates.length} earlier day(s): ${sweptDates.join(", ")}`);
    }

    if (mode === "daily") {
      // เมื่อวาน: ทุกร้านที่ active (คง behavior เดิม แม้ไม่มียอดก็ส่งไฟล์ว่าง)
      if (!groups.has(yesterday)) groups.set(yesterday, new Set());
      for (const shopid of await repo.fetchActiveShopIds()) groups.get(yesterday).add(shopid);
    }

    // 2) สร้าง CSV (วันเก่าก่อน = กวาดค้างก่อนเริ่มของใหม่)
    const fileMeta = new Map(); // folder/fileName -> { date, shopid, receiptIds }
    for (const d of [...groups.keys()].sort()) {
      const folder = path.join(baseDir, d);
      await fs.promises.mkdir(folder, { recursive: true });
      const { start, end } = dayRange(d);
      for (const shopid of groups.get(d)) {
        const rows = await repo.fetchReceiptsForShopDay(shopid, start, end);
        const fileName = `${shopid}-${d}.csv`;
        await writeCsv(path.join(folder, fileName), CSV_HEADER, rows.map(toCsvRow));
        fileMeta.set(`${d}/${fileName}`, { date: d, shopid, receiptIds: [...new Set(rows.map((r) => r.receiptid))] });
      }
    }

    // 3-5) เช็ค MinIO / อัปส่วนที่ขาด / flag / ลบ local
    const summary = { runId, mode, sweptDates, folders: [], uploaded: 0, alreadyInMinio: 0, failed: 0, receiptsSynced: 0, receiptsFailed: 0 };
    const logs = [];
    const syncedAt = Math.floor(now().getTime() / 1000);

    for (const d of await listDateFolders()) {
      const res = await reconcileFolder(path.join(baseDir, d));
      summary.folders.push({ date: d, files: res.results.length, failed: res.results.filter((r) => !r.ok).length, deleted: res.deleted });

      for (const r of res.results) {
        const meta = fileMeta.get(`${d}/${r.file}`);
        const ids = meta ? meta.receiptIds : [];
        if (r.ok) {
          r.action === "UPLOADED" ? summary.uploaded++ : summary.alreadyInMinio++;
          if (ids.length) await repo.markSynced(ids, r.objectName, syncedAt);
          summary.receiptsSynced += ids.length;
        } else {
          summary.failed++;
          if (ids.length) await repo.markFailed(ids, r.error);
          summary.receiptsFailed += ids.length;
        }
        logs.push({
          id: newId(),
          run_id: runId,
          sync_date: d,
          shopid: meta ? meta.shopid : null,
          object_name: r.objectName,
          record_count: ids.length,
          status: r.ok ? "SUCCESS" : "FAILED",
          action: r.ok ? r.action : null,
          error: r.ok ? null : r.error,
        });
      }
    }
    if (logs.length) await repo.insertLogs(logs);

    // สรุปว่าครบหรือยัง + เวลาที่ครบ
    const remaining = await repo.fetchPendingReceipts(todayTs);
    summary.pendingRemaining = remaining.length;
    summary.finishedAt = fmtDateTime(now());
    if (remaining.length === 0) {
      summary.complete = true;
      summary.completedAt = summary.finishedAt;
      logger.log(`[receiptSync] ✅ ส่ง receipt ครบแล้ว (ไม่มีรายการค้าง) เวลา ${summary.completedAt} [${mode}]`);
    } else {
      summary.complete = false;
      logger.warn(`[receiptSync] ⏳ ยังค้าง ${remaining.length} รายการ -> retry รอบถัดไป [${mode}]`);
    }
    logger.log(`[receiptSync] run ${runId} done: ${JSON.stringify(summary)}`);
    return summary;
  }

  const runDailySync = () => runSync({ mode: "daily" });

  // ---------------------------------------------------------------
  // retry รายชั่วโมง: ทำเฉพาะเมื่อมีของค้าง
  //   - ถ้ารอบ daily ของเมื่อวานยังไม่เคยรัน (server ล่มตอน 00:05) -> รัน daily แทน
  //   - ไม่มี receipt ค้าง และไม่มีโฟลเดอร์ค้าง -> ไม่ทำอะไร
  // ---------------------------------------------------------------
  async function runPendingRetry() {
    const today = startOfDay(now());
    const yesterday = fmtDate(new Date(today.getTime() - DAY_MS / 2));
    if (!(await repo.hasLogForDate(yesterday))) {
      logger.warn(`[receiptSync] ยังไม่พบรอบ daily ของ ${yesterday} -> รัน daily sync แทน`);
      return runSync({ mode: "daily" });
    }
    const pending = await repo.fetchPendingReceipts(Math.floor(today.getTime() / 1000));
    const leftovers = await listDateFolders();
    if (pending.length === 0 && leftovers.length === 0) {
      return { mode: "retry", skipped: true, complete: true, pendingRemaining: 0, checkedAt: fmtDateTime(now()) };
    }
    logger.log(`[receiptSync] retry: ค้าง ${pending.length} receipt, ${leftovers.length} โฟลเดอร์ local`);
    return runSync({ mode: "retry" });
  }

  // ---------------------------------------------------------------
  // สถานะรายวัน: ครบหรือยัง / ครบเมื่อไหร่ (GET /receiptsyncstatus)
  // ---------------------------------------------------------------
  async function getStatus({ days = 7 } = {}) {
    const today = startOfDay(now());
    const from = new Date(today.getFullYear(), today.getMonth(), today.getDate() - days);
    const rows = await repo.fetchSyncRows(Math.floor(from.getTime() / 1000), Math.floor(today.getTime() / 1000));
    const byDate = new Map();
    for (const r of rows) {
      const d = fmtDate(new Date(Number(r.create_at) * 1000));
      if (!byDate.has(d)) byDate.set(d, { date: d, total: 0, success: 0, pending: 0, failed: 0, lastSyncAt: 0 });
      const g = byDate.get(d);
      g.total++;
      const st = Number(r.sync_status);
      if (st === 1) { g.success++; g.lastSyncAt = Math.max(g.lastSyncAt, Number(r.sync_at) || 0); }
      else if (st === 2) g.failed++;
      else g.pending++;
    }
    const result = [...byDate.values()].sort((a, b) => (a.date < b.date ? 1 : -1)).map((g) => {
      const complete = g.pending + g.failed === 0;
      return {
        date: g.date, total: g.total, success: g.success, pending: g.pending, failed: g.failed,
        complete,
        // เวลาที่ครบ = เวลาที่รายการสุดท้ายของวันนั้นถูกยืนยันใน MinIO
        completedAt: complete && g.lastSyncAt ? fmtDateTime(new Date(g.lastSyncAt * 1000)) : null,
      };
    });
    return {
      checkedAt: fmtDateTime(now()),
      allComplete: result.every((r) => r.complete),
      localFoldersPending: await listDateFolders(),
      days: result,
    };
  }

  // ---------------------------------------------------------------
  // เช็ค/อัปโฟลเดอร์ที่ค้างโดยไม่ query DB (GET /uploadreceipt)
  // ---------------------------------------------------------------
  async function reconcileLeftovers({ extraFolders = [] } = {}) {
    const out = [];
    for (const d of await listDateFolders()) out.push(await reconcileFolder(path.join(baseDir, d)));
    for (const f of extraFolders) {
      if (fs.existsSync(f)) out.push(await reconcileFolder(f, { deleteWhenComplete: false }));
    }
    return out.map((r) => ({
      folder: r.folder,
      files: r.results.length,
      failed: r.results.filter((x) => !x.ok).map((x) => ({ file: x.file, error: x.error })),
      deleted: r.deleted,
    }));
  }

  return { runDailySync, runPendingRetry, getStatus, reconcileLeftovers, reconcileFolder, ensureUploaded };
}

module.exports = { createReceiptSync, CSV_HEADER, dayRange, fmtDate, fmtDateTime, sameObject, chunk };
