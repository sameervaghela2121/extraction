import { createApp } from "./app";
import { connectDb } from "./config/db";
import { env } from "./config/env";
import { logger } from "./utils/logger";

async function main() {
  await connectDb();

  const app = createApp();
  app.listen(env.port, () => {
    logger.info(`Royal Touch API listening on http://localhost:${env.port}`);
  });
}

main().catch((err) => {
  logger.error("Failed to start server:", err);
  process.exit(1);
});
