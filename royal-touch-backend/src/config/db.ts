import mongoose from "mongoose";
import { env } from "./env";

export async function connectDb(): Promise<void> {
  mongoose.set("strictQuery", true);
  await mongoose.connect(env.mongodbUri, { dbName: env.mongodbDbName });
  // eslint-disable-next-line no-console
  console.log(`[db] connected to MongoDB database "${env.mongodbDbName}"`);
}
