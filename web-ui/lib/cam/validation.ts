import { z } from 'zod';

const Point3D = z.object({
	x: z.number(),
	y: z.number(),
	z: z.number(),
});

const ToolpathSegmentSchema = z.object({
	id: z.string().optional(),
	operation_id: z.string().optional(),
	tool_id: z.string().optional(),
	segment_index: z.number().optional(),
	move_type: z.string().optional(),
	units: z.string().optional(),
	feed_mode: z.string().optional(),
	start_x: z.number().optional(),
	start_y: z.number().optional(),
	start_z: z.number().optional(),
	end_x: z.number().optional(),
	end_y: z.number().optional(),
	end_z: z.number().optional(),
	center_x: z.number().nullable().optional(),
	center_y: z.number().nullable().optional(),
	center_z: z.number().nullable().optional(),
	radius: z.number().nullable().optional(),
	feed_rate: z.number().nullable().optional(),
	rpm: z.number().nullable().optional(),
	source: z.string().optional(),
}).passthrough();

export const ToolpathRequestSchema = z.object({
	session_id: z.string().min(1, 'session_id is required'),
	job_id: z.string().min(1, 'job_id is required'),
	setup: 	z.record(z.string(), z.any()).optional(),
	operations: z.array(	z.record(z.string(), z.any())).optional(),
	features: z.array(	z.record(z.string(), z.any())).optional(),
	cam_run_id: z.string().optional(),
	setup_id: z.string().optional(),
	selected_operation_ids: z.array(z.string()).optional(),
}).passthrough();

export const GCodeRequestSchema = z.object({
	session_id: z.string().min(1, 'session_id is required'),
	job_id: z.string().min(1, 'job_id is required'),
	cam_run_id: z.string().optional(),
	setup_id: z.string().optional(),
	selected_operation_ids: z.array(z.string()).optional(),
	operations: z.array(	z.record(z.string(), z.any())).optional(),
}).passthrough();

export const AnalyzeRequestSchema = z.object({
	session_id: z.string().min(1, 'session_id is required'),
	python_script: z.string().optional(),
	parameters: 	z.record(z.string(), z.any()).optional(),
	step_file_path: z.string().optional(),
}).passthrough();

export const AutoPlanRequestSchema = z.object({
	session_id: z.string().min(1, 'session_id is required'),
	job_id: z.string().optional(),
	setup: 	z.record(z.string(), z.any()).optional(),
	operations: z.array(	z.record(z.string(), z.any())).optional(),
	features: z.array(	z.record(z.string(), z.any())).optional(),
	machine_profile: 	z.record(z.string(), z.any()).optional(),
	material: z.string().optional(),
}).passthrough();

export function validateBody<T extends z.ZodTypeAny>(schema: T, body: unknown): { success: true; data: z.infer<T> } | { success: false; error: string } {
	const result = schema.safeParse(body);
	if (result.success) return { success: true, data: result.data };
	const issues = result.error.issues.map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
	return { success: false, error: `Invalid request: ${issues}` };
}
