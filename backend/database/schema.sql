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

-- Migration: add turn timer support
ALTER TABLE games ADD COLUMN turn_started_at TIMESTAMP WITH TIME ZONE;

-- Migration: add player wallet addresses
ALTER TABLE games ADD COLUMN player_white_address VARCHAR(255);
ALTER TABLE games ADD COLUMN player_black_address VARCHAR(255);

-- Migration: add wager/escrow support
ALTER TABLE games ADD COLUMN wager_amount NUMERIC;
ALTER TABLE games ADD COLUMN token_address VARCHAR(255);
ALTER TABLE games ADD COLUMN escrow_status JSONB;

-- Migration: add game state tracking columns
ALTER TABLE games ADD COLUMN in_check BOOLEAN DEFAULT false;
ALTER TABLE games ADD COLUMN last_move JSONB;
ALTER TABLE games ADD COLUMN draw_offer VARCHAR(10);

-- Migration: add captured pieces tracking
ALTER TABLE games ADD COLUMN captured_white JSONB DEFAULT '[]';
ALTER TABLE games ADD COLUMN captured_black JSONB DEFAULT '[]';

-- Migration: add move detail columns
ALTER TABLE moves ADD COLUMN is_check BOOLEAN DEFAULT false;
ALTER TABLE moves ADD COLUMN is_checkmate BOOLEAN DEFAULT false;
ALTER TABLE moves ADD COLUMN promotion VARCHAR(5);

-- Indexes for performance
CREATE INDEX idx_games_code ON games(game_code);
CREATE INDEX idx_moves_game ON moves(game_id, move_number);

-- Enable Row Level Security (optional but recommended)
ALTER TABLE games ENABLE ROW LEVEL SECURITY;
ALTER TABLE moves ENABLE ROW LEVEL SECURITY;

-- Policies (allow all for now, customize based on your auth needs)
CREATE POLICY "Allow all operations on games" ON games FOR ALL USING (true);
CREATE POLICY "Allow all operations on moves" ON moves FOR ALL USING (true);
