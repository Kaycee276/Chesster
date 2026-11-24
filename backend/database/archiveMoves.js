#!/usr/bin/env node
const archivalService = require("../services/archivalService");
const db = require("../config/db");

function parseOptions(args) {
  let options = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === "--dry-run") options = { ...options, dryRun: true };
    else if (flag === "--older-than-days" || flag === "--batch-size") {
      const value = Number(args[++index]);
      if (!Number.isInteger(value)) throw new Error(`${flag} requires an integer`);
      options = { ...options, [flag === "--batch-size" ? "batchSize" : "olderThanDays"]: value };
    } else throw new Error("Usage: node backend/database/archiveMoves.js [--dry-run] [--older-than-days 90] [--batch-size 500]");
  }
  return options;
}

async function main(args) {
  try {
    console.log(JSON.stringify(await archivalService.archiveOldGameMoves(parseOptions(args))));
  } finally {
    await db.getPool().end();
  }
}

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    console.error("Move archival failed:", error.message);
    process.exitCode = 1;
  });
}

module.exports = { parseOptions };
