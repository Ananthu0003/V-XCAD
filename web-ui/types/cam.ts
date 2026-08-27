import type { ToolpathSegment, SimulationEvent } from './cam_simulation';

export type StockType = 
    | 'relative_box'      // 1. Relative Size Box (Part Bounding Box + Padding Allowances)
    | 'fixed_box'         // 2. Fixed Size Box (Absolute Width, Depth, Height Block)
    | 'relative_cylinder' // 3. Relative Size Cylinder (Part Bounds + Radial & Axial Allowances)
    | 'fixed_cylinder'    // 4. Fixed Size Cylinder (Absolute Diameter & Length Bar)
    | 'from_solid'        // 5. From Solid Model (CAD Solid Body Selection)
    | 'from_file'         // 6. From External File (STEP / STL Stock File)
    | 'box'               // Legacy Box
    | 'cylinder'          // Legacy Cylinder
    | 'from_model';       // Legacy Solid Model
export type MaterialType = 
    // Aluminum Alloys
    | 'aluminum_6061' | 'aluminum_7075' | 'aluminum_2024' | 'aluminum_5052' | 'aluminum_7050' | 'aluminum_cast'
    // Carbon & Alloy Steels
    | 'mild_steel' | 'steel_1045' | 'alloy_steel_4140' | 'alloy_steel_4340' | 'steel_8620'
    // Tool Steels & Hardened Steels
    | 'tool_steel_d2' | 'tool_steel_a2' | 'tool_steel_o1' | 'tool_steel_h13' | 'tool_steel_s7' | 'hardened_steel'
    // Stainless Steels
    | 'stainless_steel' | 'stainless_316' | 'stainless_17_4ph' | 'stainless_303' | 'stainless_416' | 'stainless_440c'
    // Titanium & Superalloys
    | 'titanium_gr5' | 'titanium_gr2' | 'inconel_718' | 'inconel_625' | 'hastelloy_c276' | 'monel_400'
    // Copper, Brass & Bronze
    | 'brass' | 'brass_c260' | 'copper_c110' | 'bronze_c932' | 'aluminum_bronze' | 'beryllium_copper' | 'tellurium_copper' | 'phosphor_bronze'
    // Cast Irons
    | 'cast_iron_gray' | 'cast_iron_ductile'
    // Engineering Plastics
    | 'plastic' | 'nylon_66' | 'peek' | 'abs_plastic' | 'polycarbonate' | 'ptfe_teflon' | 'uhmw_pe' | 'garolite_g10';
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
    // Phase 2 Canonical Setup Data
    setupSchemaVersion: number;
    machineType?: string;
    machineProfileId?: string;
    controllerId?: string;
    postProcessorId?: string;

    // Units
    internalUnits: 'mm' | 'in';
    displayUnits: 'mm' | 'in';
    postOutputUnits: 'mm' | 'in';

    // Material
    workpieceMaterialId?: string;

    // Hashes & Validation
    modelHash?: string;
    setupHash?: string;
    validationStatus: 'valid' | 'warning' | 'error' | 'incomplete';
    requiresSetupReview: boolean;

    // Structured Data
    stockDefinition?: any;
    originDefinition?: any;
    workCoordinateSystem?: any;
    orientation?: any;
    modelToSetupTransform?: number[][]; // 4x4 matrix
    modelPlacement?: any;
    safetyHeights?: HeightsSettings;
    workholding?: any;
    tolerances?: {
        machining: number;
        simulation: number;
        meshing: number;
    };

    // Legacy fields
    units?: 'mm' | 'in';
    machine?: string;
    stockType?: StockType;
    material?: MaterialType;
    stockDimensions?: [number, number, number]; // length, width, height in mm
    wcs?: WorkCoordinateSystem;
    originPosition?: OriginPosition;
    tolerance?: number;
    stockOffset?: number;
    stockOffsetXY?: number;
    stockOffsetTop?: number;
    stockOffsetBottom?: number;
    radialOffset?: number;
    axialOffsetTop?: number;
    axialOffsetBottom?: number;
    cylinderDiameter?: number;
    cylinderLength?: number;
    stockSolidId?: string;
    stockFilePath?: string;
    stockFileName?: string;
    machineProfile?: string;
    controller?: string;
    postProcessor?: PostProcessor | string;
    postProcessorSettings?: PostProcessorSettings;
    clampingAllowance?: number;
    clampingPosition?: 'top' | 'center' | 'bottom';
    fixtureClearance?: number;
};

export type FeatureMachiningInfo = {
    featureId: string;
    featureType: string;
    featureAxis?: [number, number, number];
    preferredToolAxis?: [number, number, number];
    machinableInCurrentSetup: boolean;
    requiredSetupAxis?: [number, number, number];
    requiresSecondarySetup: boolean;
    requires4Axis: boolean;
    requiresTurning: boolean;
    status: 'machinable_in_current_setup' | 'machinable_in_active_setup' | 'machinable_in_secondary_setup' | 'deferred_to_secondary_setup' | 'requires_turning' | 'requires_4axis_indexing' | 'requires_5axis_positioning' | 'unsupported_features' | 'unsupported' | string;
    reason?: string;
};

export type CamSetupPlan = {
    setupId: string;
    setupName: string;
    setupType: string;
    toolAxis: [number, number, number];
    workCoordinateSystem: string;
    modelToSetupTransform?: number[];
    assignedFeatureIds: string[];
    unassignedFeatureIds?: string[];
    allFeatureIds?: string[];
    requiredRotation?: [number, number, number];
    requiresManualReclamp: boolean;
    requires4AxisIndexing: boolean;
    machinableFeatures: string[];
    deferredFeatures: string[];
    unsupportedFeatures: string[];
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
    axis?: [number, number, number];
    center?: [number, number, number];
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
    
    // Topology references
    parentFaceId?: string;
    floorFaceId?: string;
    
    // Setup-aware machinability
    machining_region?: string;
    machining_info?: FeatureMachiningInfo;
    
    // Legacy fields
    machinable_in_current_setup?: boolean;
    requires_reorientation?: boolean;
    requires_4axis_or_secondary_setup?: boolean;
    blocked_reason?: string;
};

export type ToolCuttingData = {
    optimalStepdown?: number; // Ap
    optimalStepoverPercentage?: number; // Ae as %
    optimalStepover?: number; // Ae absolute
    surfaceSpeed?: number; // Vc
    feedPerTooth?: number; // Fz
    plungeFeedPerTooth?: number;
    spindleRpm?: number;
    feedRate?: number;
    plungeRate?: number;
    retractRate?: number;
    coolant?: string;
    stepdown?: number;
    stepover?: number;
    chipLoad?: number;
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
    toolCost?: number;
    toolLifeMinutes?: number;
    holderCost?: number;
    holderLifeMinutes?: number;
    cuttingData?: ToolCuttingData; // Stores optimal defaults from ToolDefinition
};

export type OperationType = 'facing' | 'pocket' | '2d_contour' | 'drilling' | 'chamfer' | 'boss_clearing' | 'od_turning' | 'rotary_milling' | 'indexed_4axis_milling' | 'indexed_5axis_milling' | 'multi_axis_surface_milling' | 'external_cylinder_unsupported' | 'side_feature' | string;
export type CoolantType = 'off' | 'flood' | 'mist' | 'through_tool' | 'air_blast';
export type OperationStatus = 'ready' | 'warning' | 'requires_regeneration' | 'missing_tool' | 'missing_geometry' | 'blocked' | 'blocked_requires_reorientation' | 'unsupported' | 'error' | 'planned' | string;

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
    finishStepdown?: number;
    finishCuts?: number;
    depthCutsEnabled?: boolean;
    totalDepth: number;
    spindleSpeed: number;
    stepoverPercentage: number;
    stepover?: number;
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

    // Backend planning / error / debug fields
    error?: string;
    errorReason?: string;
    recommended_machine?: string;
    tool_selection_reason?: string;
    feeds_and_speeds?: Record<string, number>;
    depends_on_operation?: string;
    depends_on_setup?: string;
    diagnostics?: Record<string, any>;
    blocked_reason?: string;
    strategy?: string;
    operation?: string;
    status?: string;

    // Allows backend to send extra CAM fields without breaking deployment
    [key: string]: any;
};
export type ToolpathStatistics = {
    cycleTimeSeconds: number;
    rapidDistance: number;
    cutDistance: number;
    toolChanges: number;
    materialRemovedVolume: number;
    estimatedCost?: number;
};

export type MaterialCostDetail = {
    stock_volume_mm3: number;
    part_volume_mm3?: number;
    removed_volume_mm3?: number;
    density_g_cm3: number;
    mass_kg: number;
    cost_per_kg: number;
    markup_pct: number;
    scrap_recovery_value?: number;
    cost: number;
};

export type MachiningCostDetail = {
    total_time_s: number;
    machine_rate: number;
    labor_rate: number;
    overhead_rate: number;
    hourly_rate_used: number;
    cost: number;
};

export type EnergyCostDetail = {
    avg_power_kw: number;
    energy_price_per_kwh: number;
    energy_kwh: number;
    cost: number;
};

export type SetupCostDetail = {
    setup_time_s: number;
    setup_rate: number;
    min_setup_charge: number;
    cost: number;
};

export type ToolingItemDetail = {
    tool_id: string;
    tool_name: string;
    cutting_time_min: number;
    tool_life_min?: number;
    tool_cost: number;
    wear_cost: number;
    holder_cost?: number;
    holder_life_min?: number;
    holder_amort?: number;
};

export type ToolingCostDetail = {
    items: ToolingItemDetail[];
    total: number;
};

export type SecondaryOpDetail = {
    id: string;
    name: string;
    basis: string;
    value: number;
    computed_cost: number;
};

export type SecondaryCostDetail = {
    items: SecondaryOpDetail[];
    per_part_total: number;
    per_batch_total: number;
};

export type ManufacturingCostDetail = {
    material_cost: number;
    machining_cost: number;
    energy_cost: number;
    setup_cost: number;
    tooling_cost: number;
    secondary_cost: number;
    per_part: number;
    lot: number;
};

export type SellingPriceDetail = {
    margin_pct: number;
    manufacturing_lot: number;
    profit: number;
    lot: number;
    per_unit: number;
};

export type CostEstimateResult = {
    status: string;
    currency: string;
    quantity?: number;
    learning_rate?: number;
    material?: MaterialCostDetail;
    machining?: MachiningCostDetail;
    energy?: EnergyCostDetail | null;
    setup?: SetupCostDetail;
    tooling?: ToolingCostDetail;
    secondary?: SecondaryCostDetail;
    manufacturing_cost?: ManufacturingCostDetail;
    selling_price?: SellingPriceDetail;
    total?: {
        material_cost: number;
        machining_cost: number;
        setup_cost: number;
        total_cost: number;
    };
    errors?: Array<{code: string; message: string}>;
    warnings?: Array<{code: string; message: string}>;
};

export type CollisionStatus = 'safe' | 'warning' | 'critical';

export type CamOperation = {
  id: string;
  name: string;
  type: OperationType;
  toolId: string;
  parameters: CuttingParameters;

  status?: OperationStatus | string;
  toolpaths?: unknown[];
  toolpath_schema_version?: string;

  statistics?: ToolpathStatistics;
  setup_id?: string;
  feature_id?: string;

  setupId?: string;
  featureId?: string;

  error?: string;
  errorReason?: string;
  recommended_machine?: string;
  tool_selection_reason?: string;
  feeds_and_speeds?: Record<string, number>;
  depends_on_operation?: string;
  depends_on_setup?: string;
  diagnostics?: Record<string, any>;

  heights?: HeightsSettings;
  blocked_reason?: string;
  collisionStatus?: CollisionStatus;
  enabled?: boolean;
  estimated_time_s?: number;
  estimated_breakdown?: any;

   toolpath?: any;

  // Allows backend to send extra operation fields without breaking deployment
  [key: string]: any;
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
    showStock?: boolean;
    showMachine?: boolean;
};

export type { ToolpathSegment, SimulationEvent };