const {db} = require("./db/postgresql");
const cron = require("node-cron");

exports.setshoplot = async () => {

  // Schedule a task to run every day at 00:01
  cron.schedule("1 0 * * *", async () => {
    try {
      console.log("Running scheduled task: Updating slotsremaining based on slotcapacity");

      // Update slotsremaining to match slotcapacity for all rows in the shopslot table
      await db("shopslot").update({
        // slotsremaining: db.ref("slotcapacity"),
        slotsremaining: 0,

      });

      console.log("Slots successfully updated based on slotcapacity");

    } catch (error) {
      console.error("Error resetting slots:", error.message);
    }
  });

};