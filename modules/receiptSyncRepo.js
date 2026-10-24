// DB access ของ receipt sync (knex / PostgreSQL)
const { chunk } = require("./receiptSync");

const SYNC_LOCK_KEY = 7310240001; // pg advisory lock: กัน PM2 หลาย instance รัน sync พร้อมกัน

const SYNC_PENDING = 0;
const SYNC_SUCCESS = 1;
const SYNC_FAILED = 2;

function createReceiptSyncRepo(db) {
  return {
    // receipt ที่ยังไม่ success (0 = ยังไม่ส่ง, 2 = เคยส่งล้มเหลว) ก่อน beforeTs
    fetchPendingReceipts(beforeTs) {
      return db("receiptinfo as r")
        .leftJoin("orderinfo as o", "o.ordernumber", "r.ordernumber")
        .whereIn("r.sync_status", [SYNC_PENDING, SYNC_FAILED])
        .andWhere("r.create_at", "<", beforeTs)
        .select("r.receiptid", "r.create_at", "o.shopid");
    },

    async fetchActiveShopIds() {
      const rows = await db("shopinfo").select("shopid").where({ status: true });
      return rows.map((r) => r.shopid);
    },

    // receipt ทั้งหมดของร้านในวันนั้น (ทั้งที่ส่งแล้วและยังไม่ส่ง -> ไฟล์ครบทั้งวัน)
    fetchReceiptsForShopDay(shopid, startTs, endTs) {
      return db("orderinfo")
        .join("receiptinfo", "orderinfo.ordernumber", "receiptinfo.ordernumber")
        .join("shopinfo", "orderinfo.shopid", "shopinfo.shopid")
        .where({ "orderinfo.shopid": shopid })
        .andWhere("receiptinfo.create_at", ">=", startTs)
        .andWhere("receiptinfo.create_at", "<", endTs)
        .orderBy("receiptinfo.create_at", "desc")
        .select(
          "receiptinfo.receiptid as receiptid",
          "receiptinfo.ordernumber as ordernumber",
          "receiptinfo.receiptdiscount as receiptdiscount",
          "receiptinfo.totalprice as totalprice",
          "receiptinfo.create_at as create_at",
          "shopinfo.shoptype as shoptype"
        );
    },

    async markSynced(receiptIds, objectName, syncedAt) {
      for (const ids of chunk(receiptIds, 1000)) {
        await db("receiptinfo").whereIn("receiptid", ids).update({
          sync_status: SYNC_SUCCESS,
          sync_at: syncedAt,
          sync_file: objectName,
          sync_error: null,
        });
      }
    },

    async markFailed(receiptIds, error) {
      for (const ids of chunk(receiptIds, 1000)) {
        await db("receiptinfo")
          .whereIn("receiptid", ids)
          .whereNot("sync_status", SYNC_SUCCESS) // ไม่ทับรายการที่เคย success แล้ว
          .update({
            sync_status: SYNC_FAILED,
            sync_error: String(error).slice(0, 2000),
            sync_attempts: db.raw("sync_attempts + 1"),
          });
      }
    },

    async hasLogForDate(dateStr) {
      const r = await db("receipt_sync_log").select("id").where({ sync_date: dateStr }).first();
      return !!r;
    },

    fetchSyncRows(fromTs, toTs) {
      return db("receiptinfo")
        .where("create_at", ">=", fromTs)
        .andWhere("create_at", "<", toTs)
        .select("create_at", "sync_status", "sync_at");
    },

    async insertLogs(rows) {
      for (const part of chunk(rows, 500)) await db("receipt_sync_log").insert(part);
    },

    // รัน fn เมื่อได้ lock เท่านั้น ; instance อื่นที่ชนกันจะได้ { skipped: true }
    withSyncLock(fn) {
      return db.transaction(async (trx) => {
        const r = await trx.raw("select pg_try_advisory_xact_lock(?) as ok", [SYNC_LOCK_KEY]);
        if (!r.rows[0].ok) return { skipped: true, message: "another receipt sync is running" };
        return fn();
      });
    },
  };
}

module.exports = { createReceiptSyncRepo, SYNC_PENDING, SYNC_SUCCESS, SYNC_FAILED };
