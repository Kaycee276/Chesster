// Prevent multiple instances of Prisma Client in development/hot-reloading
const globalForPrisma = global;

let prisma = globalForPrisma.prisma;

if (!prisma) {
  try {
    const { PrismaClient } = require('@prisma/client');
    prisma = new PrismaClient({
      log: process.env.NODE_ENV === 'development' ? ['error', 'warn'] : ['error'],
    });
  } catch (err) {
    // In environments where prisma client has not been generated yet or during unit tests,
    // fallback to a proxy to avoid crashing module imports
    prisma = new Proxy(
      {},
      {
        get(_target, prop) {
          if (prop === 'then' || prop === Symbol.toStringTag) return undefined;
          return () => {
            throw new Error(`PrismaClient is not initialized: ${err.message}`);
          };
        },
      }
    );
  }
}

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma;
}

module.exports = prisma;
