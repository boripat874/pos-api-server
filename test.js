let startDate = new Date("2026-06-05");
let endDate = new Date("2026-06-05");

// startDate.setHours(0, 0, 0, 0);
startDate.setDate(startDate.getDate());

// endDate.setHours(0, 0, 0, 0);
endDate.setDate(endDate.getDate()+1);

// const today = new Date();
// today.setHours(0, 0, 0, 0);
const today = new Date("2026-06-05T16:00:00.000Z");
// today.toLocaleString("th-TH");
today.setHours(today.getHours()+7);

console.log("today:", today);

console.log("startDate:", startDate);
console.log("endDate:", endDate);

let calculatedStatus = "ใช้งาน"; // ค่าเริ่มต้น

if (today.getTime() < startDate.getTime()) {
    calculatedStatus = "ยังไม่เริ่มใช้งาน"; // ถ้าวันปัจจุบันยังไม่ถึงวันเริ่มต้น
}else if (today.getTime() >= endDate.getTime()) {
    calculatedStatus = "หมดเวลา"; // ถ้าวันปัจจุบันเลยวันสิ้นสุดไปแล้ว
}
console.log("calculatedStatus:", calculatedStatus);

async function checkpromotion(Datestart, Dateend) {
  let calculatedStatus = "ใช้งาน"; // ค่าเริ่มต้น
  
  // 1. ตั้งค่าวันนี้ (เวลาไทย เที่ยงคืนตรงเป๊ะ)
  const today = new Date();
  today.setHours(0, 0, 0, 0); // เที่ยงคืนระบบเครื่องคอมพิวเตอร์ (ถ้า Server อยู่ไทยจะเป็นเวลาไทยอยู่แล้ว)

  let startDate;
  let endDate;

  try {
    // 2. จัดการวันเริ่มต้น
    startDate = new Date(Datestart);
    if (isNaN(startDate.getTime())) {
      throw { status: 400, message: "Invalid promotionstart date format" };
    }
    // รีเซ็ตให้เป็นเที่ยงคืนตรง เพื่อเอาไว้เทียบเฉพาะ "วันที่"
    startDate.setHours(0, 0, 0, 0); 

    // 3. จัดการวันสิ้นสุด
    endDate = new Date(Dateend);
    if (isNaN(endDate.getTime())) {
      throw { status: 400, message: "Invalid promotionend date format" };
    }
    // รีเซ็ตเป็นเที่ยงคืนตรง แล้วบวกเพิ่ม 1 วัน 
    // (เพื่อให้โปรโมชันครอบคลุมถึงเวลา 23:59:59 ของวันสิ้นสุดพอดี)
    endDate.setHours(0, 0, 0, 0);
    endDate.setDate(endDate.getDate() + 1);

    console.log("--- Debug Time ---");
    console.log("Today:     ", today.toLocaleString("th-TH"));
    console.log("Start Date:", startDate.toLocaleString("th-TH"));
    console.log("End Date:  ", endDate.toLocaleString("th-TH"));
    console.log("------------------");

    // 4. เปรียบเทียบเงื่อนไข
    if (today.getTime() < startDate.getTime()) {
      calculatedStatus = "ยังไม่เริ่มใช้งาน";
      console.log("Status:", calculatedStatus);
      return false; 
    } 
    
    if (today.getTime() >= endDate.getTime()) {
      calculatedStatus = "หมดเวลา";
      console.log("Status:", calculatedStatus);
      return false; 
    }

    console.log("Status:", calculatedStatus);
    return true; // อยู่ในช่วงโปรโมชัน

  } catch (dateError) {
    // เปลี่ยนจาก reject เป็น throw หรือส่ง object กลับไป (เพราะใช้ async/await)
    return {
      status: dateError.status || 400,
      message: dateError.message || "Error processing date",
    };
  }
}

checkpromotion("2026-06-04", "2026-06-04").then(result => {
  console.log("Promotion Active:", result);
}).catch(error => {
  console.error("Error:", error);
});
