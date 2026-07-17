import { 
  MACHINE_MATRIX, 
  MachineType, 
  ControllerId, 
  PostProcessorId,
  MachineProfile
} from './machineProfiles';
import { SetupSettings } from '../../types/cam';

export function getProfilesForMachineType(machineType: string): MachineProfile[] {
  return MACHINE_MATRIX.machineProfiles.filter(p => p.machineType === machineType);
}

export function getCompatibleControllers(machineProfileId: string): ControllerId[] {
  const profile = MACHINE_MATRIX.machineProfiles.find(p => p.id === machineProfileId);
  return profile ? profile.compatibleControllers : [];
}

export function getCompatiblePostProcessors(machineProfileId: string, controllerId: string): PostProcessorId[] {
  const profile = MACHINE_MATRIX.machineProfiles.find(p => p.id === machineProfileId);
  if (!profile || !controllerId) return ["AUTO"];

  const controller = MACHINE_MATRIX.controllers[controllerId as ControllerId];
  if (!controller) return ["AUTO"];

  const posts: PostProcessorId[] = ["AUTO"];
  
  for (const post of controller.compatiblePosts) {
    const postInfo = MACHINE_MATRIX.postProcessors[post];
    if (postInfo && postInfo.machineTypes.includes(profile.machineType)) {
      posts.push(post);
    }
  }

  return posts;
}

export function resolveAutoPostProcessor(machineProfileId: string, controllerId: string): PostProcessorId {
  const profile = MACHINE_MATRIX.machineProfiles.find(p => p.id === machineProfileId);
  if (!profile) return "FANUC_3X_MILL"; // Safe fallback
  
  // If the selected controller is the default, return recommended post
  if (controllerId === profile.defaultController) {
    return profile.recommendedPost;
  }
  
  // Otherwise, find the first post compatible with both the controller and machine type
  const controllerInfo = MACHINE_MATRIX.controllers[controllerId as ControllerId];
  if (controllerInfo) {
    for (const post of controllerInfo.compatiblePosts) {
      const postInfo = MACHINE_MATRIX.postProcessors[post];
      if (postInfo && postInfo.machineTypes.includes(profile.machineType)) {
        return post;
      }
    }
  }
  
  return profile.recommendedPost; // Fallback
}

export function validateMachineControllerPost(setup: SetupSettings): { valid: boolean; error?: string } {
  const profile = MACHINE_MATRIX.machineProfiles.find(p => p.id === setup.machineProfile);
  if (!profile) return { valid: false, error: "Invalid machine profile selected." };
  
  if (profile.machineType !== setup.machineType) {
    return { valid: false, error: "Machine profile does not match selected machine type." };
  }

  const controllers = getCompatibleControllers(setup.machineProfile as string);
  if (!controllers.includes(setup.controller as ControllerId)) {
    return { valid: false, error: "Controller is not compatible with the selected machine." };
  }

  if (setup.postProcessor !== "AUTO") {
    const posts = getCompatiblePostProcessors(setup.machineProfile as string, setup.controller as string);
    if (!posts.includes(setup.postProcessor as PostProcessorId)) {
      return { valid: false, error: "Post processor is not compatible with the selected controller or machine type." };
    }
  }

  return { valid: true };
}

export function migrateLegacyCamSetup(setup: SetupSettings): SetupSettings {
  const newSetup = { ...setup };
  let migrated = false;

  const legacyMachineMap: Record<string, string> = {
    "Generic 3-Axis VMC": "generic_mill_3x_vmc",
    "Haas VF-2 (3-Axis VMC)": "haas_vf2",
    "Generic 4-Axis VMC": "generic_4x_vmc",
    "Generic 5-Axis VMC": "generic_5x_vmc",
    "Generic CNC Lathe": "generic_cnc_turning_center",
    "Generic Mill-Turn Machine": "generic_mill_turn",
    "Generic 3-Axis CNC Router": "generic_3x_router"
  };

  const legacyControllerMap: Record<string, string> = {
    "FANUC": "FANUC_0I_MF",
    "Haas Control": "HAAS_NGC",
    "Siemens SINUMERIK": "SIEMENS_828D",
    "HEIDENHAIN TNC": "HEIDENHAIN_TNC",
    "Mazak MAZATROL / Smooth": "MAZAK_SMOOTH_EIA",
    "Mitsubishi CNC": "MITSUBISHI_M80_M800",
    "LinuxCNC": "LINUXCNC",
    "Mach3": "MACH3",
    "GRBL": "GRBL"
  };

  // If using legacy `machine` property instead of `machineProfile`
  if (newSetup.machine && !newSetup.machineProfile) {
    newSetup.machineProfile = legacyMachineMap[newSetup.machine] || newSetup.machine;
    migrated = true;
  }

  if (legacyControllerMap[newSetup.controller || ""]) {
    newSetup.controller = legacyControllerMap[newSetup.controller || ""] as ControllerId;
    migrated = true;
  }
  
  if (migrated && !newSetup.machineType && newSetup.machineProfile) {
    const profile = MACHINE_MATRIX.machineProfiles.find(p => p.id === newSetup.machineProfile);
    if (profile) {
      newSetup.machineType = profile.machineType;
      if (!newSetup.controller) {
        newSetup.controller = profile.defaultController;
      }
    }
  }

  // Validate post migration only if a machine is selected
  if (newSetup.machineProfile || newSetup.machineType) {
    const validation = validateMachineControllerPost(newSetup);
    if (!validation.valid) {
      console.warn("Configuration validation failed:", validation.error);
    }
  }

  return newSetup;
}
