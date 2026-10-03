import { create } from 'zustand';
import { ToolFormValues } from '@/lib/validation/toolSchema';

const defaultToolData: Partial<ToolFormValues> = {
  name: '',
  category: 'milling',
  type: 'flat_end_mill',
  unit: 'mm',
  isActive: true,
  geometry: {} as any,
  offsets: {
    lengthOffset: 1,
    diameterOffset: 1,
    compensationType: 'computer',
  },
  assembly: {} as any,
  cuttingData: {} as any
};

interface ToolWizardState {
  currentStep: number;
  toolData: Partial<ToolFormValues>;
  editingId: string | null;
  setStep: (step: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  updateToolData: (data: Partial<ToolFormValues>) => void;
  resetWizard: () => void;
  setInitialData: (data: Partial<ToolFormValues>) => void;
  setEditingId: (id: string | null) => void;
  onComplete?: () => void;
  onCancel?: () => void;
  setOnComplete: (fn?: () => void) => void;
  setOnCancel: (fn?: () => void) => void;
}

export const useToolWizardStore = create<ToolWizardState>((set) => ({
  currentStep: 1,
  toolData: { ...defaultToolData },
  editingId: null,
  
  setStep: (step) => set({ currentStep: step }),
  
  setOnComplete: (fn) => set({ onComplete: fn }),
  setOnCancel: (fn) => set({ onCancel: fn }),
  
  nextStep: () => set((state) => ({ currentStep: Math.min(state.currentStep + 1, 8) })),
  
  prevStep: () => set((state) => ({ currentStep: Math.max(state.currentStep - 1, 1) })),
  
  updateToolData: (data) => set((state) => ({
    toolData: {
      ...state.toolData,
      ...data,
      geometry: { ...state.toolData.geometry, ...data.geometry } as any,
      offsets: { ...state.toolData.offsets, ...data.offsets } as any,
      assembly: { ...state.toolData.assembly, ...data.assembly } as any,
      cuttingData: { ...state.toolData.cuttingData, ...data.cuttingData } as any,
      compatibility: { ...state.toolData.compatibility, ...data.compatibility } as any,
    }
  })),
  
  resetWizard: () => set({ currentStep: 1, toolData: { ...defaultToolData }, editingId: null }),
  
  setInitialData: (data) => set({ currentStep: 1, toolData: { ...data } }),
  
  setEditingId: (id) => set({ editingId: id }),
}));
