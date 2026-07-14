import { Schema, model, Types } from "mongoose";

export type ExportFormat = "csv" | "xlsx";

export interface IExportJob {
  _id: Types.ObjectId;
  filename: string;
  format: ExportFormat;
  filters: {
    status?: string;
    dateFrom?: Date;
    dateTo?: Date;
  };
  columns: Array<{ key: string; label: string }>;
  rowCount: number;
  generatedBy: Types.ObjectId;
  generatedAt: Date;
  filePath: string;
}

const exportJobSchema = new Schema<IExportJob>({
  filename: { type: String, required: true },
  format: { type: String, enum: ["csv", "xlsx"], required: true },
  filters: {
    status: { type: String },
    dateFrom: { type: Date },
    dateTo: { type: Date },
  },
  columns: [
    {
      key: { type: String, required: true },
      label: { type: String, required: true },
    },
  ],
  rowCount: { type: Number, required: true },
  generatedBy: { type: Schema.Types.ObjectId, ref: "User", required: true },
  generatedAt: { type: Date, default: () => new Date() },
  filePath: { type: String, required: true },
});

export const ExportJob = model<IExportJob>("ExportJob", exportJobSchema);
