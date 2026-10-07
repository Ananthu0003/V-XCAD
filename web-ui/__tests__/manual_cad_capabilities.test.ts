import {
  classifyEntity,
  isOperationApplicable,
  getApplicableOperations,
  getSelectionReadout,
  humanEntityLabel,
  OPERATION_REQUIREMENTS,
} from '../components/manual-cad/operations/capabilities';
import {
  OPERATION_REGISTRY,
  getOperationDefinition,
} from '../components/manual-cad/operations/registry';

describe('Manual CAD Step 1: Capabilities & Classification', () => {
  it('correctly classifies entities based on topology data', () => {
    expect(classifyEntity(null)).toBeNull();
    expect(classifyEntity({ entity_type: 'body' })).toBe('body');

    // Faces
    expect(classifyEntity({ entity_type: 'face', surface_type: 'plane' })).toBe('face.planar');
    expect(classifyEntity({ entity_type: 'face', surface_type: 'cylinder' })).toBe('face.cylindrical');
    expect(classifyEntity({ entity_type: 'face', surface_type: 'cone' })).toBe('face.conical');
    expect(classifyEntity({ entity_type: 'face', surface_type: 'bspline' })).toBe('face.other');

    // Edges
    expect(classifyEntity({ entity_type: 'edge', curve_type: 'line' })).toBe('edge.linear');
    expect(classifyEntity({ entity_type: 'edge', curve_type: 'circle' })).toBe('edge.circular');
    expect(classifyEntity({ entity_type: 'edge', curve_type: 'ellipse' })).toBe('edge.other');
  });

  it('validates operation applicability against capability matrix', () => {
    const planarFace = { entity_type: 'face', surface_type: 'plane' };
    const cylinderFace = { entity_type: 'face', surface_type: 'cylinder' };
    const linearEdge = { entity_type: 'edge', curve_type: 'line' };
    const circularEdge = { entity_type: 'edge', curve_type: 'circle' };
    const solidBody = { entity_type: 'body' };

    // Planar face
    expect(isOperationApplicable('hole', planarFace)).toBe(true);
    expect(isOperationApplicable('pocket', planarFace)).toBe(true);
    expect(isOperationApplicable('pad', planarFace)).toBe(true);
    expect(isOperationApplicable('fillet', planarFace)).toBe(false);
    expect(isOperationApplicable('chamfer', planarFace)).toBe(false);
    expect(isOperationApplicable('measure', planarFace)).toBe(true);

    // Edges
    expect(isOperationApplicable('fillet', linearEdge)).toBe(true);
    expect(isOperationApplicable('chamfer', linearEdge)).toBe(true);
    expect(isOperationApplicable('fillet', circularEdge)).toBe(true);
    expect(isOperationApplicable('chamfer', circularEdge)).toBe(true);
    expect(isOperationApplicable('hole', linearEdge)).toBe(false);
    expect(isOperationApplicable('pocket', linearEdge)).toBe(false);
    expect(isOperationApplicable('pad', linearEdge)).toBe(false);
    expect(isOperationApplicable('measure', linearEdge)).toBe(true);

    // Non-planar face
    expect(isOperationApplicable('hole', cylinderFace)).toBe(false);
    expect(isOperationApplicable('pocket', cylinderFace)).toBe(false);
    expect(isOperationApplicable('pad', cylinderFace)).toBe(false);
    expect(isOperationApplicable('measure', cylinderFace)).toBe(true);

    // Solid body
    expect(isOperationApplicable('select', solidBody)).toBe(true);
    expect(isOperationApplicable('hole', solidBody)).toBe(false);
  });

  it('provides applicable operations for inspector and context menu per acceptance criteria', () => {
    const planarFace = { entity_type: 'face', surface_type: 'plane' };
    const edge = { entity_type: 'edge', curve_type: 'line' };
    const cylFace = { entity_type: 'face', surface_type: 'cylinder' };

    // Acceptance: selecting a planar face offers hole/pocket/pad only
    expect(getApplicableOperations(planarFace)).toEqual(['hole', 'pocket', 'pad']);

    // Acceptance: an edge offers fillet/chamfer/measure
    expect(getApplicableOperations(edge)).toEqual(['fillet', 'chamfer', 'measure']);

    // Other face offers measure
    expect(getApplicableOperations(cylFace)).toEqual(['measure']);
  });

  it('selection readout adapts to the class using existing topology data only', () => {
    // 1. Rectangular planar face shows Width x Height (never diameter or radius)
    const rectPlanarFace = {
      entity_type: 'face',
      surface_type: 'plane',
      area: 250,
      normal: [0, 0, 1],
      width: 25.0,
      height: 10.0,
    };
    const rectReadout = getSelectionReadout(rectPlanarFace);
    const rectLabels = rectReadout.map((r) => r.label);
    expect(rectLabels).toContain('Area');
    expect(rectLabels).toContain('Normal');
    expect(rectLabels).toContain('Size');
    expect(rectLabels).not.toContain('Diameter');
    expect(rectLabels).not.toContain('Radius');
    expect(rectLabels).not.toContain('Length');

    // 2. Circular planar face shows Diameter (never width or height)
    const circPlanarFace = {
      entity_type: 'face',
      surface_type: 'plane',
      area: 78.5,
      normal: [0, 0, 1],
      radius: 5.0,
    };
    const circReadout = getSelectionReadout(circPlanarFace);
    const circLabels = circReadout.map((r) => r.label);
    expect(circLabels).toContain('Diameter');
    expect(circLabels).not.toContain('Width × Height');
    expect(circLabels).not.toContain('Size');
    expect(circReadout.find((r) => r.label === 'Diameter')?.value).toBe('⌀10.0 mm');

    // 3. Cylindrical face shows Diameter and Length (never width or height)
    const cylFace = {
      entity_type: 'face',
      surface_type: 'cylinder',
      radius: 4.0,
      length: 30.0,
      area: 753.9,
    };
    const cylReadout = getSelectionReadout(cylFace);
    const cylLabels = cylReadout.map((r) => r.label);
    expect(cylLabels).toContain('Diameter');
    expect(cylLabels).toContain('Length');
    expect(cylLabels).not.toContain('Width × Height');
    expect(cylLabels).not.toContain('Size');
    expect(cylReadout.find((r) => r.label === 'Diameter')?.value).toBe('⌀8.00 mm');
    expect(cylReadout.find((r) => r.label === 'Length')?.value).toBe('30.0 mm');

    // 4. Linear edge shows Length (never radius)
    const linearEdge = {
      entity_type: 'edge',
      curve_type: 'line',
      length: 42.5,
    };
    const linearReadout = getSelectionReadout(linearEdge);
    const linearLabels = linearReadout.map((r) => r.label);
    expect(linearLabels).toContain('Length');
    expect(linearLabels).not.toContain('Radius');
    expect(linearLabels).not.toContain('Diameter');
    expect(linearReadout.find((r) => r.label === 'Length')?.value).toBe('42.5 mm');

    // 5. Circular edge shows Radius and Length
    const circularEdge = {
      entity_type: 'edge',
      curve_type: 'circle',
      radius: 6.0,
      length: 37.7,
    };
    const circularReadout = getSelectionReadout(circularEdge);
    const circularLabels = circularReadout.map((r) => r.label);
    expect(circularLabels).toContain('Radius');
    expect(circularLabels).toContain('Length');
    expect(circularReadout.find((r) => r.label === 'Radius')?.value).toBe('R6.00 mm');
  });

  it('contains clear requirement descriptions', () => {
    expect(OPERATION_REQUIREMENTS.hole).toBe('Select a planar face');
    expect(OPERATION_REQUIREMENTS.fillet).toBe('Select an edge');
    expect(OPERATION_REQUIREMENTS.measure).toBe('Select a face or edge');
  });
});

describe('Manual CAD Step 2: Operation Registry & Schemas', () => {
  it('registers all operations with parity defaults', () => {
    const ops = ['hole', 'pocket', 'pad', 'fillet', 'chamfer', 'measure', 'select'] as const;
    ops.forEach((id) => {
      const def = getOperationDefinition(id);
      expect(def).toBeDefined();
      expect(def.id).toBe(id);
    });

    // Hole parity check
    const hole = getOperationDefinition('hole');
    const holeDia = hole.fields.find((f) => f.key === 'diameter');
    expect(holeDia?.default).toBe(6);
    expect(holeDia?.min).toBe(0.1);
    expect(holeDia?.step).toBe(0.1);

    const holeDepth = hole.fields.find((f) => f.key === 'depth');
    expect(holeDepth?.default).toBe(10);
    expect(holeDepth?.min).toBe(0.5);
    expect(holeDepth?.step).toBe(0.5);

    // Fillet parity check
    const fillet = getOperationDefinition('fillet');
    const filletRadius = fillet.fields.find((f) => f.key === 'radius');
    expect(filletRadius?.default).toBe(2);
    expect(filletRadius?.min).toBe(0.1);
    expect(filletRadius?.step).toBe(0.25);
    expect(filletRadius?.quickPresets).toEqual([1, 2, 3, 5, 8]);

    // Chamfer parity check
    const chamfer = getOperationDefinition('chamfer');
    const chamferDist = chamfer.fields.find((f) => f.key === 'distance');
    expect(chamferDist?.default).toBe(1);
    expect(chamferDist?.min).toBe(0.1);
    expect(chamferDist?.step).toBe(0.25);
    expect(chamferDist?.quickPresets).toEqual([0.5, 1, 1.5, 2, 3]);

    // Pocket parity check
    const pocket = getOperationDefinition('pocket');
    const pocketWidth = pocket.fields.find((f) => f.key === 'width');
    expect(pocketWidth?.default).toBe(25);
    const pocketDepth = pocket.fields.find((f) => f.key === 'depth');
    expect(pocketDepth?.default).toBe(6);

    // Pad parity check
    const pad = getOperationDefinition('pad');
    const padWidth = pad.fields.find((f) => f.key === 'width');
    expect(padWidth?.default).toBe(20);
    const padHeight = pad.fields.find((f) => f.key === 'height');
    expect(padHeight?.default).toBe(6);
  });

  it('enforces visibility rules across basic and advanced fields', () => {
    const hole = getOperationDefinition('hole');
    const depthField = hole.fields.find((f) => f.key === 'depth')!;
    expect(depthField.visibleWhen?.({ hole_type: 'blind' }, null)).toBe(true);
    expect(depthField.visibleWhen?.({ hole_type: 'through' }, null)).toBe(false);

    const cboreDia = hole.fields.find((f) => f.key === 'cbore_diameter')!;
    expect(cboreDia.visibleWhen?.({ hole_type: 'counterbore' }, null)).toBe(true);
    expect(cboreDia.visibleWhen?.({ hole_type: 'blind' }, null)).toBe(false);

    const csinkDia = hole.fields.find((f) => f.key === 'csink_diameter')!;
    expect(csinkDia.visibleWhen?.({ hole_type: 'countersink' }, null)).toBe(true);
    expect(csinkDia.visibleWhen?.({ hole_type: 'blind' }, null)).toBe(false);

    // Each operation shows at most 3-4 basic fields for any configuration
    // Hole
    expect(hole.fields.filter((f) => !f.advanced && (!f.visibleWhen || f.visibleWhen({ hole_type: 'blind' }, null))).length).toBeLessThanOrEqual(4);
    expect(hole.fields.filter((f) => !f.advanced && (!f.visibleWhen || f.visibleWhen({ hole_type: 'through' }, null))).length).toBeLessThanOrEqual(4);

    // Pocket
    const pocket = getOperationDefinition('pocket');
    expect(pocket.fields.filter((f) => !f.advanced && (!f.visibleWhen || f.visibleWhen({ profile: 'rectangle' }, null))).length).toBeLessThanOrEqual(4);
    expect(pocket.fields.filter((f) => !f.advanced && (!f.visibleWhen || f.visibleWhen({ profile: 'circle' }, null))).length).toBeLessThanOrEqual(4);
    expect(pocket.fields.filter((f) => !f.advanced && (!f.visibleWhen || f.visibleWhen({ profile: 'slot' }, null))).length).toBeLessThanOrEqual(4);

    // Pad
    const pad = getOperationDefinition('pad');
    expect(pad.fields.filter((f) => !f.advanced && (!f.visibleWhen || f.visibleWhen({ profile: 'rectangle' }, null))).length).toBeLessThanOrEqual(4);
    expect(pad.fields.filter((f) => !f.advanced && (!f.visibleWhen || f.visibleWhen({ profile: 'circle' }, null))).length).toBeLessThanOrEqual(4);

    // Fillet & Chamfer
    const fillet = getOperationDefinition('fillet');
    expect(fillet.fields.filter((f) => !f.advanced).length).toBeLessThanOrEqual(4);
    const chamfer = getOperationDefinition('chamfer');
    expect(chamfer.fields.filter((f) => !f.advanced).length).toBeLessThanOrEqual(4);
  });
});
