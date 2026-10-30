import { Grid3x3 } from 'lucide-react';
import { num, bodyTool, type OperationDefinition } from '../types';

export const linearPatternDefinition: OperationDefinition = bodyTool('linear_pattern', 'Linear Pattern', Grid3x3, 'Y', [
  num('count', 'Count', 3, { unit: '×', min: 2, max: 100, step: 1 }),
  num('dx', 'Spacing X', 20),
  num('dy', 'Spacing Y', 0),
  num('dz', 'Spacing Z', 0),
]);

