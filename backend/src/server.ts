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

main().catch((err) => {
  logger.error("Failed to start server:", err);
  process.exit(1);
});
