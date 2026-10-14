import { parseApiError } from '../components/manual-cad/shared';
import {
  CAPABILITY_MATRIX,
  isOperationApplicable,
  getApplicableOperations,
  TopologyEntity,
} from '../components/manual-cad/operations/capabilities';
import {
  getOperationDefinition,
  OPERATION_REGISTRY,
  getDefaultParams,
} from '../components/manual-cad/operations/registry';

describe('Manual CAD Frontend Suite', () => {
  describe('parseApiError', () => {
    it('parses string errors correctly', () => {
      const res = { status: 400, statusText: 'Bad Request' } as any;
      const parsed = parseApiError(res, 'Direct error string');
      expect(parsed.message).toBe('Direct error string');
      expect(parsed.code).toBe('HTTP_400');
    });

    it('parses Pydantic 422 detail lists into readable message', () => {
      const res = { status: 422, statusText: 'Unprocessable Entity' } as any;
      const body = {
        detail: [
          { loc: ['body', 'diameter'], msg: 'Input should be greater than 0', type: 'greater_than' },
          { loc: ['body', 'depth'], msg: 'Field required', type: 'missing' },
        ],
      };
      const parsed = parseApiError(res, body);
      expect(parsed.code).toBe('VALIDATION_ERROR');
      expect(parsed.message).toContain('diameter: Input should be greater than 0');
      expect(parsed.message).toContain('depth: Field required');
      expect(parsed.hint).toBeDefined();
    });

    it('parses FastAPI detail string', () => {
      const res = { status: 500, statusText: 'Internal Server Error' } as any;
      const body = { detail: 'OpenCASCADE boolean operation failed' };
      const parsed = parseApiError(res, body);
      expect(parsed.message).toBe('OpenCASCADE boolean operation failed');
      expect(parsed.code).toBe('HTTP_500');
    });

    it('parses structured error { error: { message, code, hint } }', () => {
      const res = { status: 400, statusText: 'Bad Request' } as any;
      const body = {
        error: {
          code: 'FILLET_FAILED',
          message: 'Fillet radius 5mm is too large for adjacent face',
          hint: 'Try radius <= 2.5mm',
        },
      };
      const parsed = parseApiError(res, body);
      expect(parsed.code).toBe('FILLET_FAILED');
      expect(parsed.message).toBe('Fillet radius 5mm is too large for adjacent face');
      expect(parsed.hint).toBe('Try radius <= 2.5mm');
    });

    it('parses validation report { validation: { error_message, error_code } }', () => {
      const body = {
        validation: {
          error_code: 'SELF_INTERSECTION',
          error_message: 'Resulting solid contains self-intersections',
          suggestions: ['Reduce pocket depth'],
        },
      };
      const parsed = parseApiError(null, body);
      expect(parsed.code).toBe('SELF_INTERSECTION');
      expect(parsed.message).toBe('Resulting solid contains self-intersections');
      expect(parsed.hint).toBe('Reduce pocket depth');
    });
  });

  describe('Capability Matrix & Applicability', () => {
    const planarFace: TopologyEntity = {
      entity_type: 'face',
      transient_id: 'face_1',
      surface_type: 'plane',
    };

    const cylinderFace: TopologyEntity = {
      entity_type: 'face',
      transient_id: 'face_2',
      surface_type: 'cylinder',
      radius: 5,
    };

    const linearEdge: TopologyEntity = {
      entity_type: 'edge',
      transient_id: 'edge_1',
      curve_type: 'line',
    };

    const circularEdge: TopologyEntity = {
      entity_type: 'edge',
      transient_id: 'edge_2',
      curve_type: 'circle',
      radius: 4,
    };

    const solidBody: TopologyEntity = {
      entity_type: 'body',
      transient_id: 'solid_rev_000',
    };

    it('includes transform in capability matrix and applies to body and entities', () => {
      expect(CAPABILITY_MATRIX.transform).toBeDefined();
      expect(CAPABILITY_MATRIX.transform).toContain('body');
      expect(isOperationApplicable('transform', solidBody)).toBe(true);
      expect(isOperationApplicable('move', solidBody)).toBe(true);
      expect(isOperationApplicable('rotate', solidBody)).toBe(true);
      expect(isOperationApplicable('scale', solidBody)).toBe(true);
    });

    it('applies edit_feature to cylindrical faces, planar faces, and body', () => {
      expect(isOperationApplicable('edit_feature', cylinderFace)).toBe(true);
      expect(isOperationApplicable('edit_feature', planarFace)).toBe(true);
      expect(isOperationApplicable('edit_feature', solidBody)).toBe(true);
    });

    it('gates hole, pocket, pad to planar face only', () => {
      expect(isOperationApplicable('hole', planarFace)).toBe(true);
      expect(isOperationApplicable('pocket', planarFace)).toBe(true);
      expect(isOperationApplicable('pad', planarFace)).toBe(true);

      expect(isOperationApplicable('hole', cylinderFace)).toBe(false);
      expect(isOperationApplicable('pocket', cylinderFace)).toBe(false);
      expect(isOperationApplicable('pad', cylinderFace)).toBe(false);

      expect(isOperationApplicable('hole', linearEdge)).toBe(false);
    });

    it('gates fillet and chamfer to edges only', () => {
      expect(isOperationApplicable('fillet', linearEdge)).toBe(true);
      expect(isOperationApplicable('fillet', circularEdge)).toBe(true);
      expect(isOperationApplicable('chamfer', linearEdge)).toBe(true);
      expect(isOperationApplicable('chamfer', circularEdge)).toBe(true);

      expect(isOperationApplicable('fillet', planarFace)).toBe(false);
      expect(isOperationApplicable('chamfer', solidBody)).toBe(false);
    });
  });

  describe('toRequest: Form Values Translated to API Request', () => {
    it('translates hole form values into exact API request structure', () => {
      const holeDef = getOperationDefinition('hole');
      expect(holeDef).toBeDefined();
      const formValues = {
        hole_type: 'counterbore',
        diameter: 8.5,
        depth: 22,
        cb_diameter: 14.0,
        cb_depth: 6.0,
        pos_u: 10,
        pos_v: -5,
      };
      const req = holeDef.toRequest(formValues, { entity_type: 'face', transient_id: 'face_1', surface_type: 'plane' });
      expect(req.hole_type).toBe('counterbore');
      expect(req.diameter).toBe(8.5);
      expect(req.depth).toBe(22);
      expect(req.cb_diameter).toBe(14.0);
      expect(req.cb_depth).toBe(6.0);
    });

    it('translates pocket form values with profile and draft angle', () => {
      const pocketDef = getOperationDefinition('pocket');
      const formValues = {
        profile: 'rectangle',
        width: 35,
        height: 25,
        depth: 8,
        corner_radius: 2.5,
        through_all: false,
        draft_angle: 3.0,
      };
      const req = pocketDef.toRequest(formValues, null);
      expect(req.profile).toBe('rectangle');
      expect(req.width).toBe(35);
      expect(req.height).toBe(25);
      expect(req.depth).toBe(8);
      expect(req.corner_radius).toBe(2.5);
      expect(req.draft_angle).toBe(3.0);
    });

    it('translates edit_feature dimension edit values (Part B2)', () => {
      const editDef = getOperationDefinition('edit_feature');
      const formValues = {
        kind: 'rect',
        length: 60,
        width: 40,
        height: 25,
        corner_radius: 3,
        area: 2400,
        anchor: 'center',
      };
      const req = editDef.toRequest(formValues, { entity_type: 'face', transient_id: 'f_top' });
      expect(req.kind).toBe('rect');
      expect(req.length).toBe(60);
      expect(req.width).toBe(40);
      expect(req.height).toBe(25);
      expect(req.area).toBe(2400);
      expect(req.anchor).toBe('center');
    });

    it('translates transform values (move, rotate, scale)', () => {
      const transformDef = getOperationDefinition('transform');
      const moveVals = { mode: 'move', direction: 'xyz', dx: 15, dy: -10, dz: 5 };
      const reqMove = transformDef.toRequest(moveVals, null);
      expect(reqMove.mode).toBe('move');
      expect(reqMove.dx).toBe(15);
      expect(reqMove.dy).toBe(-10);

      const rotVals = { mode: 'rotate', axis: 'face_normal', angle: 45, pivot: 'center' };
      const reqRot = transformDef.toRequest(rotVals, null);
      expect(reqRot.mode).toBe('rotate');
      expect(reqRot.axis).toBe('face_normal');
      expect(reqRot.angle).toBe(45);

      const scaleVals = { mode: 'scale', scale_type: 'uniform', factor: 2.0, pivot: 'origin' };
      const reqScale = transformDef.toRequest(scaleVals, null);
      expect(reqScale.mode).toBe('scale');
      expect(reqScale.factor).toBe(2.0);
    });
  });

  describe('Per-Operation Parameter Isolation (Bug A9 & A10)', () => {
    it('ensures distinct tools do not bleed default parameters', () => {
      const holeDefaults = getDefaultParams('hole');
      const pocketDefaults = getDefaultParams('pocket');
      const padDefaults = getDefaultParams('pad');
      const filletDefaults = getDefaultParams('fillet');
      const chamferDefaults = getDefaultParams('chamfer');

      expect(holeDefaults.diameter).toBe(6);
      expect(holeDefaults.depth).toBe(10);

      expect(pocketDefaults.width).toBe(12);
      expect(pocketDefaults.height).toBe(18);
      expect(pocketDefaults.depth).toBe(6);

      expect(padDefaults.width).toBe(20);
      expect(padDefaults.length).toBe(20);
      expect(padDefaults.height).toBe(6);

      expect(filletDefaults.radius).toBe(2);
      expect(chamferDefaults.distance).toBe(1);
    });
  });
});
