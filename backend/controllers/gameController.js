const gameModel = require('../models/gameModel');

class GameController {
  async createGame(req, res) {
    try {
      const { gameType } = req.body;
      const game = await gameModel.createGame(gameType);
      res.status(201).json({ success: true, data: game });
    } catch (error) {
      res.status(500).json({ success: false, error: error.message });
    }
  }

  async joinGame(req, res) {
    try {
      const { gameCode } = req.params;
      const { playerColor } = req.body;
      const game = await gameModel.joinGame(gameCode, playerColor);
      
      const io = req.app.get('io');
      io.to(gameCode).emit('game-update', game);
      
      res.json({ success: true, data: game });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async getGame(req, res) {
    try {
      const { gameCode } = req.params;
      const game = await gameModel.getGame(gameCode);
      res.json({ success: true, data: game });
    } catch (error) {
      res.status(404).json({ success: false, error: error.message });
    }
  }

  async makeMove(req, res) {
    try {
      const { gameCode } = req.params;
      const { from, to, promotion } = req.body;
      const game = await gameModel.makeMove(gameCode, from, to, promotion);
      
      const io = req.app.get('io');
      io.to(gameCode).emit('game-update', game);
      
      res.json({ success: true, data: game });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async getMoves(req, res) {
    try {
      const { gameCode } = req.params;
      const moves = await gameModel.getMoves(gameCode);
      res.json({ success: true, data: moves });
    } catch (error) {
      res.status(404).json({ success: false, error: error.message });
    }
  }

  async resignGame(req, res) {
    try {
      const { gameCode } = req.params;
      const { playerColor } = req.body;
      const game = await gameModel.resignGame(gameCode, playerColor);
      
      const io = req.app.get('io');
      io.to(gameCode).emit('game-update', game);
      
      res.json({ success: true, data: game });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async offerDraw(req, res) {
    try {
      const { gameCode } = req.params;
      const { playerColor } = req.body;
      const game = await gameModel.offerDraw(gameCode, playerColor);
      
      const io = req.app.get('io');
      io.to(gameCode).emit('game-update', game);
      
      res.json({ success: true, data: game });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  }

  async acceptDraw(req, res) {
    try {
      const { gameCode } = req.params;
      const game = await gameModel.acceptDraw(gameCode);
      
      const io = req.app.get('io');
      io.to(gameCode).emit('game-update', game);
      
      res.json({ success: true, data: game });
    } catch (error) {
      res.status(400).json({ success: false, error: error.message });
    }
  }
}

module.exports = new GameController();
