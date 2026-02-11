import { useGameStore } from './store/gameStore';
import GameLobby from './components/GameLobby';
import ChessBoard from './components/ChessBoard';
import Toast from './components/Toast';

const App = () => {
  const gameCode = useGameStore((state) => state.gameCode);

  return (
    <>
      <Toast />
      {gameCode ? <ChessBoard /> : <GameLobby />}
    </>
  );
};

export default App;
