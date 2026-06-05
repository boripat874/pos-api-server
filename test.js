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

console.log(today.getTime());
console.log(startDate.getTime());
console.log(endDate.getTime());
