import { useEffect } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useGameStore } from '../store/gameStore';
import ChessBoard from '../components/ChessBoard';

export default function GamePage() {
  const { gameCode } = useParams<{ gameCode: string }>();
  const navigate = useNavigate();
  const { rejoinGame, gameCode: storedGameCode, playerColor } = useGameStore();

  useEffect(() => {
    if (!gameCode) {
      navigate('/');
      return;
    }

    if (storedGameCode === gameCode && playerColor) {
      rejoinGame(gameCode);
    } else {
      navigate('/');
    }
  }, [gameCode, storedGameCode, playerColor, rejoinGame, navigate]);

  return <ChessBoard />;
}
