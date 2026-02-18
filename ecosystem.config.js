module.exports = {
  apps : [{
    name: "POS-Server",
    script: 'index.js',
    watch: true,
    env: {
      NameDatabase: "pg",
      Host: "127.0.0.1",
      Users: "pgadmin",
      Password: "0000",
      Database: "pos",
      Port: 443
    },
    
  }],
};
