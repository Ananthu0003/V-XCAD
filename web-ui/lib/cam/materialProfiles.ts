import matrixData from './cam_material_matrix.json';
import type { MaterialType } from '@/types/cam';

export type MaterialCategory = 
  | 'aluminum'
  | 'steels'
  | 'tool_steels'
  | 'stainless_steels'
  | 'titanium_superalloys'
  | 'copper_brass_bronze'
  | 'cast_irons'
  | 'plastics';

export interface MaterialCategoryInfo {
  id: MaterialCategory;
  label: string;
  description: string;
}

export interface MaterialProfileItem {
  id: MaterialType | string;
  name: string;
  category: MaterialCategory;
  categoryLabel: string;
  machinabilityRating: number;
  cuttingSpeedMMin: number;
  feedPerToothMm: number;
  coolantRequirement: 'flood' | 'mist' | 'air_blast' | 'dry' | 'high_pressure';
  compatibleToolMaterials: string[];
  densityGcm3: number;
  hardnessHb: number;
  description: string;
}

export const MATERIAL_MATRIX = matrixData as unknown as {
  categories: MaterialCategoryInfo[];
  materials: MaterialProfileItem[];
};

export function getMaterialProfile(materialId?: string): MaterialProfileItem | undefined {
  if (!materialId) return undefined;
  return MATERIAL_MATRIX.materials.find(m => m.id === materialId);
}

export function getMaterialLabel(materialId?: string): string {
  if (!materialId) return 'Not selected';
  const profile = getMaterialProfile(materialId);
  if (profile) return profile.name;
  
  // Fallback formatting for legacy or custom strings
  return materialId
    .replace(/_/g, ' ')
    .replace(/\b\w/g, l => l.toUpperCase());
}

export function getMaterialsByCategory(): Map<string, MaterialProfileItem[]> {
  const map = new Map<string, MaterialProfileItem[]>();
  for (const cat of MATERIAL_MATRIX.categories) {
    const items = MATERIAL_MATRIX.materials.filter(m => m.category === cat.id);
    if (items.length > 0) {
      map.set(cat.label, items);
    }
  }
  return map;
}
