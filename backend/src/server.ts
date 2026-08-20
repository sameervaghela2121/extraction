import { createApp } from "./app";
import { connectDb } from "./config/db";
import { env } from "./config/env";
import { fieldDefinitionsService } from "./services/fieldDefinitions.service";
import { logger } from "./utils/logger";

async function main() {
  await connectDb();
  await fieldDefinitionsService.ensureDefaults();

  const app = createApp();
  app.listen(env.port, () => {
    logger.info(`DocFlow API listening on http://localhost:${env.port}`);
  });
}

// A rejection nobody awaited would otherwise kill the process on Node 15+, taking every
// in-flight request with it. Log it and keep serving — the request that caused it has
// already had its own error response from errorHandler.
process.on("unhandledRejection", (reason) => {
  logger.error("Unhandled promise rejection:", reason);
});

// An uncaught exception leaves the process in an unknown state, so this only logs before
// letting it exit — the supervisor restarts a clean one.
process.on("uncaughtException", (err) => {
  logger.error("Uncaught exception, shutting down:", err);
  process.exit(1);
});

main().catch((err) => {
  logger.error("Failed to start server:", err);
  process.exit(1);
});
