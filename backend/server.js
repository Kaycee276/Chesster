require("dotenv").config();
const express = require("express");
const cors = require("cors");
const http = require("http");
const { Server } = require("socket.io");
const gameRoutes = require("./routes/gameRoutes");
const escrowRoutes = require("./routes/escrowRoutes");
const timerService = require("./services/timerService");
const supabase = require("./config/supabase");

const app = express();
const server = http.createServer(app);

const CORS_ORIGIN = process.env.CORS_ORIGIN || "*";

const io = new Server(server, {
	cors: {
		origin: CORS_ORIGIN,
		methods: ["GET", "POST"],
	},
});

const PORT = process.env.PORT || 3000;

app.use(
	cors({
		origin: CORS_ORIGIN,
		methods: ["GET", "POST"],
	}),
);
app.use(express.json());

app.use("/api", gameRoutes);
app.use("/api/escrow", escrowRoutes);

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

	socket.on("send-chat", async ({ gameCode, playerColor, message }) => {
		if (!gameCode || !playerColor || !message) return;
		if (!["white", "black"].includes(playerColor)) return;

		// Sanitize: strip HTML tags, control chars, limit to 50 chars
		const sanitized = String(message)
			.replace(/<[^>]*>/g, "")
			.replace(/[<>]/g, "")
			.trim()
			.slice(0, 50);
		if (!sanitized) return;

		const { data, error } = await supabase
			.from("chat_messages")
			.insert({ game_code: gameCode, player_color: playerColor, message: sanitized })
			.select()
			.single();

		if (!error && data) {
			io.to(gameCode).emit("chat-message", {
				id: data.id,
				playerColor: data.player_color,
				message: data.message,
				createdAt: data.created_at,
			});
		}
	});
});

app.set("io", io);
timerService.init(io);

server.listen(PORT, "0.0.0.0", () => {
	console.log(`Chesster backend running on port ${PORT}`);
});
