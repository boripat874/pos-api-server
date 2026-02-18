const date = require("date-and-time");

exports.convertTotimestamp = async function name(params) {

    let period = params.query.period || "today"; // ค่าที่เป็นไปได้: "today", "thisweek", "thismonth", "thisyear" , "bydate"

    const now = new Date(); // รับวันที่และเวลาปัจจุบัน *เมื่อโค้ดทำงาน*

    // Calculate default for date_start: timestamp in seconds for the beginning of the current day
    const defaultStartTimestamp = Math.floor(new Date(now).setHours(0, 0, 0, 0) / 1000);

    // Calculate default for date_end: timestamp in seconds for the beginning of the next day
    const Endtime = new Date(now);
    Endtime.setDate(Endtime.getDate() + 1);
    Endtime.setHours(0, 0, 0, 0);
    const defaultEndTimestamp = Math.floor(Endtime.getTime() / 1000);

    let date_start = params.query.date_start;
    let date_end = params.query.date_end;

    // console.log(date_start);
    // console.log(date_end);


    let startTimestamp;
    let endTimestamp;

    // --- คำนวณ timestamp เริ่มต้นและสิ้นสุดตามช่วงเวลา (period) ---

    if (period === "thisyear") {

        // จุดเริ่มต้นของปีปัจจุบัน (1 มกราคม, 00:00:00)
        const startOfYear = new Date(now.getFullYear(), 0, 1); // เดือนเป็นแบบ 0-indexed (0 = มกราคม)
        startOfYear.setHours(0, 0, 0, 0);
        startTimestamp = Math.floor(startOfYear.getTime() / 1000);

        // จุดเริ่มต้นของปีถัดไป (1 มกราคม ของปีถัดไป, 00:00:00)
        const startOfNextYear = new Date(now.getFullYear() + 1, 0, 1);
        startOfNextYear.setHours(0, 0, 0, 0);
        endTimestamp = Math.floor(startOfNextYear.getTime() / 1000);

    } else if (period === "thismonth") {

        // จุดเริ่มต้นของเดือนปัจจุบัน (วันที่ 1, 00:00:00)
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        startOfMonth.setHours(0, 0, 0, 0);
        startTimestamp = Math.floor(startOfMonth.getTime() / 1000);

        // จุดเริ่มต้นของเดือนถัดไป (วันที่ 1 ของเดือนถัดไป, 00:00:00)
        const startOfNextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1); // JS จัดการการเปลี่ยนเดือน/ปีอัตโนมัติ
        startOfNextMonth.setHours(0, 0, 0, 0);
        endTimestamp = Math.floor(startOfNextMonth.getTime() / 1000);

    } else if (period === "thisweek") {

        // จุดเริ่มต้นของสัปดาห์ปัจจุบัน (สมมติว่าวันอาทิตย์เป็นวันแรก, วันที่ 0)
        const currentDayOfWeek = now.getDay(); // 0 สำหรับวันอาทิตย์, 1 สำหรับวันจันทร์, ..., 6 สำหรับวันเสาร์
        const startOfWeek = new Date(now); // สร้างสำเนา
        startOfWeek.setDate(now.getDate() - currentDayOfWeek); // ย้อนกลับไปหาวันอาทิตย์ล่าสุด
        startOfWeek.setHours(0, 0, 0, 0);
        startTimestamp = Math.floor(startOfWeek.getTime() / 1000);

        // จุดเริ่มต้นของสัปดาห์ถัดไป (วันอาทิตย์หน้า, 00:00:00)
        const startOfNextWeek = new Date(startOfWeek);
        startOfNextWeek.setDate(startOfWeek.getDate() + 7); // เพิ่ม 7 วัน

        // ชั่วโมงถูกตั้งค่าเป็น 00:00:00.000 แล้ว
        endTimestamp = Math.floor(startOfNextWeek.getTime() / 1000);

    } else if (period === "bydate") {

        const startDate = new Date(date_start) || defaultStartTimestamp; // สร้างสำเนา
        startDate.setHours(0, 0, 0, 0); // ชั่วโมงถูกตั้งค่าเป็น 00:00:00.000 แล้ว
        startTimestamp = Math.floor(startDate.getTime() / 1000)

        const endDate = new Date(date_end) || defaultEndTimestamp; // สร้างสำเนา
        endDate.setDate(endDate.getDate() + 1); // เพิ่ม 1 วัน
        endDate.setHours(0, 0, 0, 0); // ชั่วโมงถูกตั้งค่าเป็น 00:00:00.000 แล้ว
        endTimestamp = Math.floor(endDate.getTime() / 1000)

    } else {

        // กรณีเริ่มต้น, รวมถึง period === "today"
        // จุดเริ่มต้นของวันนี้ (00:00:00)
        const today = new Date(now); // สร้างสำเนา
        today.setHours(0, 0, 0, 0);
        startTimestamp = Math.floor(today.getTime() / 1000);

        // จุดเริ่มต้นของวันพรุ่งนี้ (00:00:00)
        const tomorrow = new Date(today);
        tomorrow.setDate(today.getDate() + 1);
        // ชั่วโมงถูกตั้งค่าเป็น 00:00:00.000 แล้ว
        endTimestamp = Math.floor(tomorrow.getTime() / 1000);

    }

    // console.log(startTimestamp);
    // console.log(endTimestamp);


    return {
        startTimestamp,
        endTimestamp,
    };
}