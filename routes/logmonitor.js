// Log Monitor (หน้าดู syslog ของระบบ) : เฉพาะผู้ดูแลระบบ (LOGVIEW_USER / LOGVIEW_PASSWORD ใน .env)
const express = require("express");
const router = express.Router();
const lm = require("../controllers/logMonitor");

router.get("/", lm.page);
router.post("/api/login", lm.login);
router.get("/api/logs", lm.logs);

module.exports = router;
