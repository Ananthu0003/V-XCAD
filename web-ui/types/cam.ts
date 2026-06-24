import type { ToolpathSegment, SimulationEvent } from './cam_simulation';

export type StockType = 'box' | 'cylinder' | 'from_model';
export type MaterialType = 'aluminum_6061' | 'mild_steel' | 'stainless_steel' | 'brass' | 'plastic';
export type WorkCoordinateSystem = 'G54' | 'G55' | 'G56' | 'G57' | 'G58' | 'G59';
export type OriginPosition = 'top_center' | 'model_center' | 'bottom_center' | 'front_left_top';

export type PostProcessor = 'iso' | 'fanuc' | 'siemens' | 'heidenhain' | 'mazak' | 'haas' | 'mitsubishi' | 'grbl' | 'mach3' | 'linuxcnc';

export type PostProcessorSettings = {
    programNumber: number;
    units: 'metric' | 'imperial';
    sequenceNumbers: boolean;
    arcOutputMode: 'ij' | 'r';
};

export type SetupSettings = {
    units: 'mm' | 'in';
    machine: string;
    stockType: StockType;
    material: MaterialType;
    stockDimensions: [number, number, number]; // length, width, height in mm
    wcs: WorkCoordinateSystem;
    originPosition: OriginPosition;
    tolerance: number;
    stockOffset: number;
    postProcessor?: PostProcessor;
    postProcessorSettings?: PostProcessorSettings;
};

export type ToolType = 'flat_end_mill' | 'ball_nose' | 'face_mill' | 'drill' | 'chamfer_mill';
export type ToolMaterial = 'hss' | 'carbide' | 'hss_co' | 'carbide_insert' | 'ceramic' | 'cbn' | 'pcd';

export type FeatureType = 'through_hole' | 'blind_hole' | 'pocket' | 'slot' | 'boss' | 'contour' | 'chamfer' | 'fillet' | 'step';
export type MachinabilityStatus = 'machinable' | 'limited' | 'not_machinable';

export type CamFeature = {
    id: string;
    type: FeatureType | string;
    name?: string;
    dimensions: Record<string, number>; // e.g., { diameter: 10, depth: 5 }
    location: [number, number, number]; // Center coordinate
    position?: {
        center: [number, number, number];
        normal: [number, number, number];
        bounding_box?: { min: [number, number, number]; max: [number, number, number] };
    };
    manufacturing?: {
        is_through?: boolean;
        machining_side?: string;
        access_direction?: [number, number, number];
        requires_tool?: boolean;
    };
    confidence?: number;
    source?: string;
    
    // Grouping properties
    groupName?: string;
    count?: number;
    pattern?: string;
    features?: string[]; // IDs of sub-features
    
    status: MachinabilityStatus;
    statusReason?: string;
    recommendedToolType: ToolType | string;
    recommendedOperation: OperationType | string;
};

export type Tool = {
    id: string; // Internal ID
    dbId?: string; // Reference to the ToolDefinition in the DB
    name?: string;
    number: string; // T1, T2
    type: ToolType;
    diameter: number;
    flutes: number;
    stickout: number;
    material: ToolMaterial;
    coating?: string;
    lengthOffsetH?: string;
    diameterOffsetD?: string;
    holder?: string;
    gaugeLength?: number;
    toolLife?: number;
    toolWear?: number;
};

export type OperationType = 'facing' | 'pocket' | '2d_contour' | 'drilling' | 'chamfer';
export type CoolantType = 'off' | 'flood' | 'mist' | 'through_tool' | 'air_blast';
export type OperationStatus = 'ready' | 'requires_regeneration' | 'missing_tool' | 'missing_geometry';

export type HeightsSettings = {
    clearanceHeight: number;
    retractHeight: number;
    feedHeight: number;
    topHeight: 'stock_top' | 'model_top' | 'selection' | number;
    bottomHeight: 'stock_bottom' | 'model_bottom' | 'selection' | number;
};

export type ToolpathLinking = {
    leadInRadius: number;
    leadOutRadius: number;
    helicalEntry: boolean;
    rampAngle: number;
    transitionMoves: 'straight' | 'smooth';
    smoothing: boolean;
};

export type CuttingParameters = {
    feedRate: number;
    plungeRate: number;
    maxStepdown: number;
    totalDepth: number;
    spindleSpeed: number;
    stepoverPercentage: number;
    tolerance: number;
    coolant: CoolantType;
    
    // Operation specific settings
    insideOutside?: 'inside' | 'outside';
    climbConventional?: 'climb' | 'conventional';
    compensation?: 'computer' | 'wear' | 'off';
    stockToLeave?: number;
    finishPass?: boolean;
    
    adaptive?: boolean;
    offsetPattern?: boolean;
    rasterAngle?: number;
    spiral?: boolean;
    restMachining?: boolean;
    cornerCleanup?: boolean;

    drillCycle?: 'G81' | 'G82' | 'G83' | 'G84';
    peckDepth?: number;
    dwellTime?: number;
    retractType?: 'G98' | 'G99';

    facingPattern?: 'zig_zag' | 'one_way' | 'spiral';
    overlapPercentage?: number;

    chamferWidth?: number;
    chamferAngle?: number;
    passCount?: number;

    linking?: ToolpathLinking;
};

export type ToolpathStatistics = {
    cycleTimeSeconds: number;
    rapidDistance: number;
    cutDistance: number;
    toolChanges: number;
    materialRemovedVolume: number;
    estimatedCost?: number;
};

export type CollisionStatus = 'safe' | 'warning' | 'critical';

export type CamOperation = {
    id: string;
    name: string;
    type: OperationType;
    toolId: string;
    feature_id?: string;
    parameters: CuttingParameters;
    heights?: HeightsSettings;
    status?: OperationStatus;
    statistics?: ToolpathStatistics;
    collisionStatus?: CollisionStatus;
    enabled?: boolean;
};

export type ViewportSettings = {
    showStock: boolean;
    showTool: boolean;
    showToolpath: boolean;
    showOrigin: boolean;
    showAxes: boolean;
};

export type SimulationState = {
    isPlaying: boolean;
    progress: number;
    speed: 1 | 2 | 5 | 10;
    
    // Backend-driven state
    simulationRunId?: string | null;
    segments?: ToolpathSegment[];
    events?: SimulationEvent[];
    activeSegmentIndex?: number;
    currentTimeSec?: number;
    showTool?: boolean;
};
