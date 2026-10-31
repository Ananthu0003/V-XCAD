import { Orbit } from 'lucide-react';
import { num, seg, bodyTool, type FieldOption, type OperationDefinition } from '../types';

const AXIS_OPTS: FieldOption[] = [
  { value: 'x', label: 'X' },
  { value: 'y', label: 'Y' },
  { value: 'z', label: 'Z' },
];

export const polarPatternDefinition: OperationDefinition = bodyTool('polar_pattern', 'Polar Pattern', Orbit, 'U', [
  num('count', 'Count', 4, { unit: '×', min: 2, max: 100, step: 1 }),
  num('angle', 'Total angle', 360, { unit: '°', step: 15 }),
  seg('axis', 'Axis', 'z', AXIS_OPTS),
  num('cx', 'Centre X', 0),
  num('cy', 'Centre Y', 0),
  num('cz', 'Centre Z', 0),
]);

