import express from "express";
import cors from "cors";
import morgan from "morgan";
import { env } from "./config/env";
import apiRoutes from "./routes";
import { notFoundHandler, errorHandler } from "./middleware/errorHandler.middleware";

export function createApp() {
  const app = express();

  // Open CORS: the client is a native Android app, which sends no Origin and enforces
  // no CORS. The only browsers hitting this are dev tools, so there is no origin
  // worth pinning here (unlike the portal, which serves exactly one web frontend).
  app.use(cors());
  app.use(express.json());
  if (env.nodeEnv !== "test") app.use(morgan("dev"));

  app.use("/api/v1", apiRoutes);

  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
