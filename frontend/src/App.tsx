import { BrowserRouter, Routes, Route } from 'react-router-dom';
import GameLobby from './components/GameLobby';
import GamePage from './pages/GamePage';
import Toast from './components/Toast';

const App = () => {
  return (
    <BrowserRouter>
      <Toast />
      <Routes>
        <Route path="/" element={<GameLobby />} />
        <Route path="/:gameCode" element={<GamePage />} />
      </Routes>
    </BrowserRouter>
  );
};

export default App;
