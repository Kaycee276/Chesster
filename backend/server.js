require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const gameRoutes = require("./routes/gameRoutes");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
	cors: { origin: "*" }
});

const PORT = process.env.PORT || 3000;

app.use(cors({ origin: "*" }));
app.use(express.json());

app.use("/api", gameRoutes);

app.get("/health", (req, res) => {
	res.json({ status: "ok", message: "Chesster backend running" });
});

io.on("connection", (socket) => {
	socket.on("join-game", (gameCode) => {
		socket.join(gameCode);
	});

	socket.on("leave-game", (gameCode) => {
		socket.leave(gameCode);
	});
});

app.set("io", io);

server.listen(PORT, "0.0.0.0", () => {
	console.log(`Chesster backend running on port ${PORT}`);
});
