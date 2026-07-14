import {
  FieldDefinition,
  DEFAULT_INVOICE_FIELD_DEFINITIONS,
  type IFieldDefinition,
} from "../models/FieldDefinition.model";
import { ApiError } from "../utils/ApiError";

export const fieldDefinitionsService = {
  /** Ensure the built-in invoice field set exists (idempotent — safe to call on boot). */
  async ensureDefaults(): Promise<void> {
    const count = await FieldDefinition.countDocuments();
    if (count === 0) {
      await FieldDefinition.insertMany(DEFAULT_INVOICE_FIELD_DEFINITIONS);
    }
  },

  async list(): Promise<IFieldDefinition[]> {
    return FieldDefinition.find().sort({ order: 1, createdAt: 1 }).lean();
  },

  /** Enabled custom fields, sent to the extraction service so it looks for them by name. */
  async listEnabledCustomForPrompt(): Promise<Array<{ key: string; label: string; description?: string }>> {
    const defs = await FieldDefinition.find({ isCustom: true, enabled: true })
      .sort({ order: 1 })
      .select("key label description")
      .lean();
    return defs.map((d) => ({ key: d.key, label: d.label, description: d.description }));
  },

  async toggle(key: string, enabled: boolean) {
    const def = await FieldDefinition.findOne({ key });
    if (!def) throw ApiError.notFound("Field definition not found");
    if (def.required && !enabled) {
      throw ApiError.badRequest("Required fields cannot be disabled");
    }
    def.enabled = enabled;
    await def.save();
    return def.toObject();
  },

  async addCustom(input: { key?: string; label: string; description?: string }) {
    const key = (input.key ?? input.label).trim().toLowerCase().replace(/[^a-z0-9]+/g, "_");
    if (!key) throw ApiError.badRequest("A field key or label is required");
    const existing = await FieldDefinition.findOne({ key });
    if (existing) throw ApiError.conflict("A field with this key already exists");
    const maxOrder = await FieldDefinition.findOne().sort({ order: -1 }).select("order").lean();
    const def = await FieldDefinition.create({
      key,
      label: input.label,
      description: input.description,
      required: false,
      enabled: true,
      isCustom: true,
      order: (maxOrder?.order ?? 0) + 1,
    });
    return def.toObject();
  },

  async remove(key: string) {
    const def = await FieldDefinition.findOne({ key });
    if (!def) throw ApiError.notFound("Field definition not found");
    if (!def.isCustom) throw ApiError.badRequest("Built-in fields cannot be removed, only disabled");
    await def.deleteOne();
    return { removed: key };
  },
};
