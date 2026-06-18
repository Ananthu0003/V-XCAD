export type StockType = 'box' | 'cylinder' | 'from_model';
export type MaterialType = 'aluminum_6061' | 'mild_steel' | 'stainless_steel' | 'brass' | 'plastic';
export type WorkCoordinateSystem = 'G54' | 'G55' | 'G56' | 'G57' | 'G58' | 'G59';
export type OriginPosition = 'top_center' | 'model_center' | 'bottom_center' | 'front_left_top';

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
};

export type ToolType = 'flat_end_mill' | 'ball_nose' | 'face_mill' | 'drill' | 'chamfer_mill';
export type ToolMaterial = 'hss' | 'carbide' | 'hss_co' | 'carbide_insert' | 'ceramic' | 'cbn' | 'pcd';

export type FeatureType = 'through_hole' | 'blind_hole' | 'pocket' | 'slot' | 'boss' | 'contour' | 'chamfer' | 'fillet' | 'step';
export type MachinabilityStatus = 'machinable' | 'limited' | 'not_machinable';

export type CamFeature = {
    id: string;
    type: FeatureType;
    dimensions: Record<string, number>; // e.g., { diameter: 10, depth: 5 }
    location: [number, number, number];
    status: MachinabilityStatus;
    statusReason?: string;
    recommendedToolType: ToolType;
    recommendedOperation: OperationType;
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
};

export type OperationType = 'facing' | 'pocket' | '2d_contour' | 'drilling' | 'chamfer';
export type CoolantType = 'off' | 'flood' | 'mist';

export type CuttingParameters = {
    feedRate: number;
    plungeRate: number;
    maxStepdown: number;
    totalDepth: number;
    spindleSpeed: number;
    stepoverPercentage: number;
    tolerance: number;
    coolant: CoolantType;
};

export type CamOperation = {
    id: string;
    name: string;
    type: OperationType;
    toolId: string;
    parameters: CuttingParameters;
};

export type PostProcessor = 'iso' | 'fanuc' | 'siemens' | 'heidenhain' | 'mazak' | 'haas' | 'mitsubishi';

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
};
