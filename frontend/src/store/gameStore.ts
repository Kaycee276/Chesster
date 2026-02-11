import { create } from 'zustand';
import { api } from '../api/gameApi';

interface GameStore {
  gameCode: string | null;
  playerColor: 'white' | 'black' | null;
  board: string[][];
  currentTurn: 'white' | 'black';
  status: string;
  selectedSquare: [number, number] | null;
  
  createGame: () => Promise<void>;
  joinGame: (code: string, color: 'white' | 'black') => Promise<void>;
  fetchGameState: () => Promise<void>;
  makeMove: (from: [number, number], to: [number, number]) => Promise<void>;
  selectSquare: (pos: [number, number] | null) => void;
  reset: () => void;
}

export const useGameStore = create<GameStore>((set, get) => ({
  gameCode: null,
  playerColor: null,
  board: [],
  currentTurn: 'white',
  status: '',
  selectedSquare: null,

  createGame: async () => {
    const data = await api.createGame();
    if (data.success) {
      await get().joinGame(data.data.game_code, 'white');
    }
  },

  joinGame: async (code: string, color: 'white' | 'black') => {
    const data = await api.joinGame(code, color);
    if (data.success) {
      set({ gameCode: code, playerColor: color });
      await get().fetchGameState();
    } else {
      throw new Error(data.error);
    }
  },

  fetchGameState: async () => {
    const { gameCode } = get();
    if (!gameCode) return;
    
    const data = await api.getGame(gameCode);
    if (data.success) {
      set({
        board: data.data.board_state,
        currentTurn: data.data.current_turn,
        status: data.data.status
      });
    }
  },

  makeMove: async (from: [number, number], to: [number, number]) => {
    const { gameCode } = get();
    if (!gameCode) return;
    
    const data = await api.makeMove(gameCode, from, to);
    if (data.success) {
      set({
        board: data.data.board_state,
        currentTurn: data.data.current_turn,
        selectedSquare: null
      });
    } else {
      throw new Error(data.error);
    }
  },

  selectSquare: (pos: [number, number] | null) => set({ selectedSquare: pos }),

  reset: () => set({
    gameCode: null,
    playerColor: null,
    board: [],
    currentTurn: 'white',
    status: '',
    selectedSquare: null
  })
}));
