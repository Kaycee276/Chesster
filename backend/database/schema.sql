-- Run this SQL in your Supabase SQL Editor

-- Games table
CREATE TABLE games (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_code VARCHAR(10) UNIQUE NOT NULL,
  game_type VARCHAR(50) DEFAULT 'chess',
  board_state JSONB NOT NULL,
  current_turn VARCHAR(10) NOT NULL,
  status VARCHAR(20) DEFAULT 'waiting',
  player_white BOOLEAN DEFAULT false,
  player_black BOOLEAN DEFAULT false,
  move_count INTEGER DEFAULT 0,
  winner VARCHAR(10),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Moves table
CREATE TABLE moves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  game_id UUID REFERENCES games(id) ON DELETE CASCADE,
  move_number INTEGER NOT NULL,
  player VARCHAR(10) NOT NULL,
  from_position JSONB NOT NULL,
  to_position JSONB NOT NULL,
  piece VARCHAR(5) NOT NULL,
  board_state_after JSONB NOT NULL,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for performance
CREATE INDEX idx_games_code ON games(game_code);
CREATE INDEX idx_moves_game ON moves(game_id, move_number);

-- Enable Row Level Security (optional but recommended)
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE moves ENABLE ROW LEVEL SECURITY;

-- Policies (allow all for now, customize based on your auth needs)
CREATE POLICY "Allow all operations on games" ON games FOR ALL USING (true);
CREATE POLICY "Allow all operations on moves" ON moves FOR ALL USING (true);
