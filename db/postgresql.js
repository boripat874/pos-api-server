const knex = require("knex");

require("dotenv").config();

exports.db = knex({
  client: process.env.NameDatabase,
  connection: {
    host: process.env.Host,
    user: process.env.Users,
    password: process.env.Password,
    database: process.env.Database,
  },
});