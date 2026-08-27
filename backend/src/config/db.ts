import mongoose from "mongoose";
import { env } from "./env";

export async function connectDb(): Promise<void> {
  mongoose.set("strictQuery", true);
  await mongoose.connect(env.mongodbUri, {
    dbName: env.mongodbDbName,
    // Off in production. Left on, Mongoose re-issues createIndex for every declared index
    // on every connect — and with min-instances=0 that is every cold start. It is what
    // silently resurrected the old unique royal_touche_code index after it was dropped:
    // any container still running the previous build put it straight back.
    //
    // Indexes in production are applied deliberately instead: `npm run indexes` shows the
    // difference, `npm run indexes -- --apply` reconciles it. Development keeps autoIndex
    // so a new index appears the moment it is written.
    autoIndex: env.nodeEnv !== "production",
  });
  // eslint-disable-next-line no-console
  console.log(`[db] connected to MongoDB database "${env.mongodbDbName}"`);
}
