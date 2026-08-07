import { SharedFile } from "../models/SharedFiles.model";

/** Wait briefly for the Python service to register Files docs under a job_id (they're written synchronously in /extract). */
export async function findFilesForJob(jobId: string, expected: number) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const files = await SharedFile.find({ job_id: jobId }).sort({ idx: 1 });
    if (files.length >= expected) return files;
    await new Promise((r) => setTimeout(r, 300));
  }
  return SharedFile.find({ job_id: jobId }).sort({ idx: 1 });
}
