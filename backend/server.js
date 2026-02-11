require("dotenv").config();
const express = require("express");
const cors = require("cors");
const gameRoutes = require("./routes/gameRoutes");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors({ origin: "*" }));
app.use(express.json());

app.use("/api", gameRoutes);

app.get("/health", (req, res) => {
	res.json({ status: "ok", message: "Chesster backend running" });
});

app.listen(PORT, "0.0.0.0", () => {
	console.log(`Chesster backend running on port ${PORT}`);
});
