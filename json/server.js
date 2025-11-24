console.log("Server.js berhasil dibaca Node!");

const http = require("http");

const server = http.createServer((req, res) => {
  res.writeHead(200, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ msg: "Backend minimal bekerja!" }));
});

server.listen(4000, () => {
  console.log("Server berjalan di http://localhost:4000");
});
