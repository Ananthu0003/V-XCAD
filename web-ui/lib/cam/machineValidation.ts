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
    "Generic 3-Axis VMC": "haas_vf2",
    "generic_mill_3x_vmc": "haas_vf2",
    "Haas VF-2 (3-Axis VMC)": "haas_vf2",
    "Generic 4-Axis VMC": "haas_vf2_hrt160",
    "generic_mill_4x_vmc": "haas_vf2_hrt160",
    "generic_4x_vmc": "haas_vf2_hrt160",
    "Generic 5-Axis VMC": "haas_umc750",
    "generic_mill_5x_vmc": "haas_umc750",
    "generic_5x_vmc": "haas_umc750",
    "Generic CNC Lathe": "haas_st20",
    "generic_cnc_lathe": "haas_st20",
    "generic_cnc_turning_center": "haas_st20",
    "Generic Mill-Turn Machine": "mazak_integrex_i200",
    "generic_mill_turn": "mazak_integrex_i200",
    "Generic 3-Axis CNC Router": "haas_gr510",
    "generic_router_3x": "haas_gr510",
    "generic_3x_router": "haas_gr510"
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

  // Migrate legacy machine names and deleted generic IDs to standard real-world profiles
  const currentMachine = newSetup.machineProfile || newSetup.machine;
  if (currentMachine && legacyMachineMap[currentMachine]) {
    newSetup.machineProfile = legacyMachineMap[currentMachine];
    newSetup.machine = legacyMachineMap[currentMachine];
    migrated = true;
  } else if (newSetup.machine && !newSetup.machineProfile) {
    newSetup.machineProfile = newSetup.machine;
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

  if (!newSetup.material && !newSetup.workpieceMaterialId) {
    newSetup.material = "aluminum_6061";
    newSetup.workpieceMaterialId = "aluminum_6061";
  }
  if (!newSetup.machineProfile && !newSetup.machine) {
    newSetup.machine = "haas_vf2";
    newSetup.machineProfile = "haas_vf2";
  }

  return newSetup;
}
