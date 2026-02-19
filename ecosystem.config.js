module.exports = {
  apps : [{
    name: "POS-Server",
    script: 'index.js',
    watch: true,
    env: {
      NameDatabase: "pg",
      Host: "10.10.17.2",
      Users: "postgres",
      Password: "zoo@pos2026_pgsql",
      Database: "pos",
      Port: 443
    },
    
  }],
};
