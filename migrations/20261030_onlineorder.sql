-- =====================================================================
-- ออเดอร์ Online จากระบบภายนอก (POST /api/pos/orderinsert)  : POS_Server 1.0.7
-- เก็บแยกจาก orderinfo / orderdetail (order หลักของเครื่อง POS)
-- ไม่ผูกกับร้าน ; แสดงเฉพาะในรายงานการสั่งซื้อ (เลือก "Online" / "ทั้งหมด") ; ไม่นับรวมในยอดรวม
-- รันซ้ำได้ : ถ้ามีตารางเดิม (มี shopid) จะลบคอลัมน์ shopid และเพิ่ม buyername ให้
-- =====================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS onlineorderinfo (
    onlineorderid             VARCHAR      NOT NULL,              -- uuid
    ordernumber               VARCHAR      NOT NULL,              -- orderNumber
    receiptnumber             VARCHAR,                            -- receiptNumber
    referencenumber           VARCHAR,                            -- referenceNumber
    buyername                 VARCHAR,                            -- buyerName
    orderdatetime             TIMESTAMPTZ  NOT NULL,              -- orderDateTime
    ordertimestamp            BIGINT       NOT NULL,              -- orderDateTime เป็น epoch วินาที (ใช้กรองช่วงเวลาในรายงาน)
    orderstatus               VARCHAR,                            -- orderStatus เช่น COMPLETED
    deliveryoption            VARCHAR,                            -- deliveryOption เช่น PICKUP
    netamount                 NUMERIC      NOT NULL DEFAULT 0,    -- netAmount
    paymentchannel            VARCHAR,                            -- payment.channel (text เช่น Credit Card)
    paymenttime               TIMESTAMPTZ,                        -- payment.time
    paymenttransactionnumber  VARCHAR,                            -- payment.transactionNumber
    status                    BOOLEAN      NOT NULL DEFAULT true,
    create_at                 BIGINT       NOT NULL DEFAULT (EXTRACT(epoch FROM now()))::bigint,
    update_at                 BIGINT       NOT NULL DEFAULT (EXTRACT(epoch FROM now()))::bigint,
    CONSTRAINT onlineorderinfo_pkey PRIMARY KEY (onlineorderid),
    CONSTRAINT onlineorderinfo_ordernumber_key UNIQUE (ordernumber)
);
-- ตารางเดิมจากเวอร์ชันก่อน: เพิ่ม buyername, ลบ shopid (ออเดอร์ Online ไม่ผูกกับร้าน)
ALTER TABLE onlineorderinfo ADD COLUMN IF NOT EXISTS buyername VARCHAR;
DROP INDEX IF EXISTS idx_onlineorderinfo_shop_time;
ALTER TABLE onlineorderinfo DROP COLUMN IF EXISTS shopid;

CREATE INDEX IF NOT EXISTS idx_onlineorderinfo_time ON onlineorderinfo (ordertimestamp);

CREATE TABLE IF NOT EXISTS onlineorderdetail (
    id              VARCHAR  NOT NULL,                            -- uuid
    onlineorderid   VARCHAR  NOT NULL,
    linenumber      INTEGER  NOT NULL,                            -- ลำดับใน items
    productcode     VARCHAR,                                      -- items[].productCode
    productname     VARCHAR,                                      -- items[].productName
    quantity        NUMERIC  NOT NULL DEFAULT 0,                  -- items[].quantity
    unitprice       NUMERIC  NOT NULL DEFAULT 0,                  -- items[].unitPrice
    discount        NUMERIC  NOT NULL DEFAULT 0,                  -- items[].discount
    create_at       BIGINT   NOT NULL DEFAULT (EXTRACT(epoch FROM now()))::bigint,
    CONSTRAINT onlineorderdetail_pkey PRIMARY KEY (id),
    CONSTRAINT onlineorderdetail_order_fk FOREIGN KEY (onlineorderid)
        REFERENCES onlineorderinfo (onlineorderid) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_onlineorderdetail_order ON onlineorderdetail (onlineorderid);

COMMIT;
