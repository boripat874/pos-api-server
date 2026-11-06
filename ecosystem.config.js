module.exports = {
  apps : [{
    name: "POS-Server",
    script: 'index.js',
    instances: "1",
    autorestart: true,
    watch: true,
    // ไม่ restart เมื่อไฟล์ log / ไฟล์อัปโหลดเปลี่ยน (syslog ของระบบเขียนลง logs/ ตลอดเวลา)
    ignore_watch: ["node_modules", "logs", "uploads", "fileuploads", "datacsv"],
    env: {
      NameDatabase: "pg",
      Host: "10.10.17.2",
      Users: "postgres",
      Password: "zoo@pos2026_pgsql",
      Database: "pos",
      Port: 80,
      SYSTEM_LOG_ENABLED: true,
      SYSTEM_LOG_DIR: "./logs",
      SYSTEM_LOG_RETENTION_DAYS: 7
    },
    
  }],
};
