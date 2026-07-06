import matrixData from './cam_machine_matrix.json';

export type MachineType = 
  | "MILL_3X_VMC" 
  | "MILL_4X_VMC" 
  | "MILL_5X_VMC" 
  | "CNC_LATHE" 
  | "MILL_TURN" 
  | "DRILL_TAP_CENTER" 
  | "ROUTER_3X";

export type ControllerId = 
  | "FANUC_0I_MF" 
  | "HAAS_NGC" 
  | "SIEMENS_828D" 
  | "SIEMENS_840D_ONE" 
  | "HEIDENHAIN_TNC" 
  | "MAZAK_SMOOTH_EIA" 
  | "MITSUBISHI_M80_M800" 
  | "OKUMA_OSP" 
  | "BROTHER_CNC_D00" 
  | "LINUXCNC" 
  | "MACH3" 
  | "GRBL";

export type PostProcessorId = 
  | "AUTO" 
  | "FANUC_3X_MILL" 
  | "HAAS_NGC_3X_MILL" 
  | "SIEMENS_828D_3X_MILL" 
  | "SIEMENS_840D_ONE_3X_MILL" 
  | "HEIDENHAIN_TNC_3X_MILL" 
  | "MAZAK_SMOOTH_EIA_3X_MILL" 
  | "MITSUBISHI_M80_M800_3X_MILL" 
  | "OKUMA_OSP_3X_MILL" 
  | "BROTHER_DRILL_TAP_MILL" 
  | "LINUXCNC_3X_MILL" 
  | "MACH3_3X_ROUTER" 
  | "GRBL_3X_ROUTER";

export interface CamSupport {
  setup: boolean;
  featureRecognition: boolean;
  toolpathGeneration: boolean;
  gcodeGeneration: boolean;
}

export interface MachineProfile {
  id: string;
  label: string;
  machineType: MachineType;
  axisCount: number;
  defaultController: ControllerId;
  compatibleControllers: ControllerId[];
  recommendedPost: PostProcessorId;
  camSupport: CamSupport;
}

export interface ControllerInfo {
  label: string;
  industrial: boolean;
  compatiblePosts: PostProcessorId[];
}

export interface PostProcessorInfo {
  label: string;
  description?: string;
  controller: ControllerId | null;
  machineTypes: MachineType[];
  supports: Record<string, boolean>;
}

export const MACHINE_MATRIX = matrixData as {
  machineTypes: { id: MachineType; label: string }[];
  machineProfiles: MachineProfile[];
  controllers: Record<ControllerId, ControllerInfo>;
  postProcessors: Record<PostProcessorId, PostProcessorInfo>;
};
