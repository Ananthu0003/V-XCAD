import { z } from 'zod';

export const toolGeometrySchema = z.object({
  diameter: z.number().positive("Diameter must be positive"),
  cuttingDiameter: z.number().positive().optional(),
  cornerRadius: z.number().min(0).optional(),
  ballRadius: z.number().min(0).optional(),
  fluteLength: z.number().positive("Flute length must be positive"),
  cuttingLength: z.number().positive().optional(),
  overallLength: z.number().positive("Overall length must be positive"),
  shankDiameter: z.number().positive().optional(),
  neckDiameter: z.number().positive().optional(),
  neckLength: z.number().min(0).optional(),
  fluteCount: z.number().int().min(1, "Must have at least 1 flute").optional(),
  helixAngle: z.number().min(0).optional(),
  taperAngle: z.number().min(0).optional(),
  pointAngle: z.number().positive().optional(),
  includedAngle: z.number().positive().optional(),
  cuttingWidth: z.number().positive().optional(),
  insertCount: z.number().int().positive().optional(),
  leadAngle: z.number().min(0).optional(),
  arborDiameter: z.number().positive().optional(),
  profilePointsJson: z.string().optional(),
}).superRefine((data, ctx) => {
  if (data.overallLength <= data.fluteLength) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Overall length must be greater than flute length",
      path: ["overallLength"]
    });
  }

  if (data.cornerRadius !== undefined && data.cornerRadius > data.diameter / 2) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Corner radius cannot exceed half the diameter",
      path: ["cornerRadius"]
    });
  }
});

export const toolOffsetSchema = z.object({
  lengthOffset: z.number().int().positive("Length offset must be positive"),
  diameterOffset: z.number().int().positive("Diameter offset must be positive"),
  headNumber: z.number().int().positive().optional(),
  compensationType: z.enum(['computer', 'control', 'wear', 'inverse_wear', 'off']).optional(),
});

export const toolAssemblySchema = z.object({
  holderId: z.string().uuid().optional().or(z.literal('')),
  stickoutLength: z.number().positive("Stickout length must be positive"),
  totalLength: z.number().positive().optional(),
  safeClearanceLength: z.number().positive().optional(),
});

export const toolCuttingDataSchema = z.object({
  spindleRpm: z.number().int().positive("RPM must be positive"),
  feedRate: z.number().positive("Feed rate must be positive"),
  plungeRate: z.number().positive("Plunge rate must be positive"),
  retractRate: z.number().positive("Retract rate must be positive"),
  coolant: z.enum(['off', 'flood', 'mist', 'air', 'through_spindle']),
  stepdown: z.number().positive().optional(),
  stepover: z.number().positive().optional(),
  chipLoad: z.number().positive().optional(),
  surfaceSpeed: z.number().positive().optional(),
  feedPerTooth: z.number().positive().optional(),
});

export const toolCompatibilitySchema = z.object({
  compatibleOperationsJson: z.string().optional(),
  compatibleMachinesJson: z.string().optional(),
  compatibleMaterialsJson: z.string().optional(),
  unsupportedReason: z.string().optional(),
});

export const toolSchema = z.object({
  name: z.string().min(1, "Tool name is required"),
  category: z.enum(['milling', 'drilling', 'turning', 'custom_form']),
  type: z.enum([
    'flat_end_mill', 'ball_end_mill', 'bull_nose_end_mill', 'drill', 
    'chamfer_mill', 'face_mill', 'thread_mill', 't_slot_cutter', 
    'dovetail_cutter', 'reamer', 'boring_bar', 'custom_profile_tool'
  ]),
  description: z.string().optional(),
  manufacturer: z.string().optional(),
  partNumber: z.string().optional(),
  unit: z.enum(['mm', 'inch']),
  isActive: z.boolean().default(true),
  
  geometry: toolGeometrySchema,
  offsets: toolOffsetSchema,
  assembly: toolAssemblySchema.optional(),
  cuttingData: toolCuttingDataSchema.optional(),
  compatibility: toolCompatibilitySchema.optional(),
}).superRefine((data, ctx) => {
  // Validate type specific rules
  if (data.type === 'ball_end_mill' && data.geometry.ballRadius !== data.geometry.diameter / 2) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Ball radius should equal half the diameter for a ball end mill",
      path: ["geometry", "ballRadius"]
    });
  }

  if (data.type === 'drill' && !data.geometry.pointAngle) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Point angle is required for drills",
      path: ["geometry", "pointAngle"]
    });
  }

  if (data.type === 'chamfer_mill' && !data.geometry.includedAngle) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Included angle is required for chamfer mills",
      path: ["geometry", "includedAngle"]
    });
  }

  if (data.type === 'custom_profile_tool' && !data.geometry.profilePointsJson) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      message: "Profile points are required for custom profile tools",
      path: ["geometry", "profilePointsJson"]
    });
  }

  if (data.assembly && data.assembly.stickoutLength && data.geometry.fluteLength) {
    if (data.assembly.stickoutLength < data.geometry.fluteLength) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Stickout length cannot be less than flute length",
        path: ["assembly", "stickoutLength"]
      });
    }

    if (data.assembly.stickoutLength > data.geometry.overallLength) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "Stickout length cannot be greater than overall length",
        path: ["assembly", "stickoutLength"]
      });
    }
  }
});

export type ToolFormValues = z.infer<typeof toolSchema>;
