// Keep tests hermetic: production configuration remains fail-closed, while
// modules imported by isolated route/service tests get safe placeholders.
process.env.SUPABASE_URL ||= 'http://localhost';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';
process.env.SUPABASE_KEY ||= 'test-service-key';
process.env.SOROBAN_RPC_URL ||= 'https://soroban-testnet.stellar.org';
process.env.JWT_SECRET ||= 'test-jwt-secret-key-chesster-123456';

