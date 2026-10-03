import { getMaterialProfile, MaterialProfileItem } from './materialProfiles';

export interface MaterialValidationResult {
  valid: boolean;
  warnings: string[];
  recommendations: string[];
}

export function validateToolForMaterial(toolMaterial: string, workpieceMaterialId?: string): MaterialValidationResult {
  const warnings: string[] = [];
  const recommendations: string[] = [];
  const mat = getMaterialProfile(workpieceMaterialId);

  if (!mat) {
    return { valid: true, warnings: [], recommendations: [] };
  }

  const toolMatLower = toolMaterial.toLowerCase();
  const compatible = mat.compatibleToolMaterials.map(m => m.toLowerCase());

  if (!compatible.includes(toolMatLower) && !compatible.includes('all')) {
    warnings.push(`Tool material '${toolMaterial}' may not be optimal for ${mat.name}. Recommended tool materials: ${mat.compatibleToolMaterials.join(', ').toUpperCase()}.`);
  }

  if (mat.machinabilityRating < 30 && toolMatLower === 'hss') {
    warnings.push(`High strength/hardened material ${mat.name} will rapidly wear HSS tooling. Carbide or CBN tools strongly advised.`);
  }

  return {
    valid: warnings.length === 0,
    warnings,
    recommendations
  };
}

export function getRecommendedCuttingParameters(workpieceMaterialId?: string, toolDiameterMm: number = 10) {
  const mat = getMaterialProfile(workpieceMaterialId);
  if (!mat) {
    // Default fallback (Aluminum 6061 parameters)
    const vc = 300;
    const fz = 0.08;
    const rpm = Math.round((vc * 1000) / (Math.PI * toolDiameterMm));
    return {
      spindleRpm: Math.min(Math.max(rpm, 500), 24000),
      feedRateMMin: Math.round(rpm * fz * 3),
      cuttingSpeedMMin: vc,
      feedPerToothMm: fz,
      coolant: 'flood'
    };
  }

  const vc = mat.cuttingSpeedMMin;
  const fz = mat.feedPerToothMm;
  const rpm = Math.round((vc * 1000) / (Math.PI * toolDiameterMm));

  return {
    spindleRpm: Math.min(Math.max(rpm, 200), 30000),
    feedRateMMin: Number((rpm * fz * 3 / 1000).toFixed(2)), // m/min or mm/min depending on context
    cuttingSpeedMMin: vc,
    feedPerToothMm: fz,
    coolant: mat.coolantRequirement
  };
}
