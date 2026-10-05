process.env.NODE_ENV = 'test';
process.env.DATABASE_URL ||= 'postgresql://postgres:postgres@localhost:5432/postgres';
process.env.SUPABASE_URL ||= 'http://localhost';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';
process.env.SUPABASE_KEY ||= 'test-service-key';
process.env.SOROBAN_RPC_URL ||= 'https://soroban-testnet.stellar.org';
process.env.STELLAR_RPC_URL ||= 'https://soroban-testnet.stellar.org';
process.env.JWT_SECRET ||= 'test-jwt-secret-key-chesster-123456';
delete process.env.REDIS_URL;

