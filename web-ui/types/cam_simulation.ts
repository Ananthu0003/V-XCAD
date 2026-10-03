export interface ToolpathSegment {
	id: string;
	simulation_run_id: string;
	operation_id: string | null;
	tool_id: string | null;
	segment_index: number;
	move_type: 'rapid' | 'linear' | 'arc_cw' | 'arc_ccw' | string;
	units: string;
	feed_mode: string | null;
	source: string;
	start_x: number;
	start_y: number;
	start_z: number;
	start_i: number;
	start_j: number;
	start_k: number;
	end_x: number;
	end_y: number;
	end_z: number;
	end_i: number;
	end_j: number;
	end_k: number;
	center_x: number | null;
	center_y: number | null;
	center_z: number | null;
	radius: number | null;
	feed_rate: number | null;
	rpm: number | null;
	length_mm: number;
	estimated_time_sec: number;
}

export interface SimulationEvent {
	id: string;
	simulation_run_id: string;
	event_type: 'tool_change' | 'operation_start' | 'operation_end' | 'spindle_on' | 'spindle_off' | 'coolant_on' | 'coolant_off' | 'warning' | 'collision_warning' | string;
	time_sec: number;
	operation_id: string | null;
	tool_id: string | null;
	message: string | null;
}

export interface SimulationRun {
	id: string;
	job_id: string;
	setup_id: string;
	total_runtime_sec: number;
	total_distance_mm: number;
	cutting_distance_mm: number;
	rapid_distance_mm: number;
	status: string;
	validation_status: string | null;
	validation_errors: any | null;
	validation_warnings: any | null;
	created_at: string;
	setup?: any;
}

export interface PaginatedSegmentsResponse {
	status: string;
	segments: ToolpathSegment[];
	pagination: {
		skip: number;
		take: number;
		total: number;
		hasMore: boolean;
	};
}

export interface TimelineEventsResponse {
	status: string;
	events: SimulationEvent[];
}
