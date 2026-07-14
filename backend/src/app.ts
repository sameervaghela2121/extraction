import express from "express";
import cors from "cors";
import morgan from "morgan";
import { env } from "./config/env";
import apiRoutes from "./routes";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler.middleware";

export function createApp() {
  const app = express();

  app.use(cors({ origin: env.frontendOrigin, credentials: true }));
  app.use(express.json({ limit: "5mb" }));
  app.use(express.urlencoded({ extended: true }));
  if (env.nodeEnv !== "test") app.use(morgan("dev"));

  app.use("/api", apiRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
