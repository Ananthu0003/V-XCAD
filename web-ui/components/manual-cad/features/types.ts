import React from 'react';
import type { LucideIcon } from 'lucide-react';
import type { CADToolType } from '../ManualCadToolbar';
import { EntityClassification, CAPABILITY_MATRIX, TopologyEntity } from '../operations/capabilities';
import { GeometryContext } from '../operations/context';

export type FieldType = 'number' | 'select' | 'segment' | 'toggle' | 'position';

export interface FieldOption {
  value: string;
  label: string;
  meta?: Record<string, unknown>;
}

export interface OperationField {
  key: string;
  label: string;
  type: FieldType;
  unit?: string;
  min?: number;
  max?: number;
  step?: number;
  default: unknown;
  options?: FieldOption[];
  advanced?: boolean;
  visibleWhen?: (values: Record<string, unknown>, entity: TopologyEntity | null | undefined) => boolean;
  quickPresets?: number[];
  placeholder?: string;
  initial?: (ctx: GeometryContext, values: Record<string, unknown>) => unknown;
  bounds?: (ctx: GeometryContext, values: Record<string, unknown>) => { min?: number; max?: number; step?: number };
}

export interface OperationDefinition {
  id: CADToolType;
  label: string;
  icon: LucideIcon;
  shortcut: string;
  appliesTo: EntityClassification[];
  requiresSelection: boolean;
  fields: OperationField[];
  previewable: boolean;
  toRequest: (values: Record<string, unknown>, selection: TopologyEntity | null | undefined) => Record<string, unknown>;
  customForm?: React.ComponentType<{
    params: Record<string, unknown>;
    onChange: (k: string, v: unknown) => void;
    entity?: TopologyEntity | null;
  }>;
}

export const num = (
  key: string,
  label: string,
  def: number,
  opts: Partial<OperationField> = {},
): OperationField => ({
  key,
  label,
  type: 'number',
  unit: 'mm',
  step: 1,
  default: def,
  advanced: false,
  ...opts,
});

export const seg = (
  key: string,
  label: string,
  def: string,
  options: FieldOption[],
  opts: Partial<OperationField> = {},
): OperationField => ({
  key,
  label,
  type: 'segment',
  options,
  default: def,
  advanced: false,
  ...opts,
});

export const tog = (
  key: string,
  label: string,
  def: boolean,
  opts: Partial<OperationField> = {},
): OperationField => ({
  key,
  label,
  type: 'toggle',
  default: def,
  advanced: false,
  ...opts,
});

export function bodyTool(
  id: CADToolType,
  label: string,
  icon: LucideIcon,
  shortcut: string,
  fields: OperationField[],
  previewable = true,
): OperationDefinition {
  return {
    id,
    label,
    icon,
    shortcut,
    appliesTo: CAPABILITY_MATRIX[id],
    requiresSelection: true,
    previewable,
    fields,
    toRequest: (values) => ({ ...values }),
  };
}

