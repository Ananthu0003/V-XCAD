import type { CamFeature } from '@/types/cam';
import type { StlGeometryInfo } from '@/components/viewport/StlMesh';
import type { AnnotationEntry } from '@/components/viewport/DimensionOverlay';

export type TargetPortionSource = 'brep_feature' | 'parameter_group' | 'annotation' | 'custom_region' | 'add_new';

export type TargetPortionShape = 'cylinder' | 'box' | 'point' | 'region';

export type TargetPortion = {
	id: string;
	name: string;
	category: string;
	description?: string;
	quickPrompts?: string[];
	cropBox?: { x: number; y: number; w: number; h: number };
	sourceType?: TargetPortionSource;
	shape?: TargetPortionShape;
	location?: [number, number, number];
	center?: [number, number, number];
	axis?: [number, number, number];
	boxSize?: [number, number, number];
	dimensions?: Record<string, number>;
	parameterKeys?: string[];
	isExistingGeometry?: boolean;
};

export const ADD_NEW_FEATURE_TEMPLATES: TargetPortion[] = [
	{
		id: 'add_groove',
		name: '+ Add Groove / Undercut / O-Ring',
		category: 'Add New Feature',
		description: 'Create a new seal groove, snap ring recess, or neck undercut',
		sourceType: 'add_new',
		shape: 'cylinder',
		isExistingGeometry: false,
		quickPrompts: [
			'Add an O-ring seal groove at the specified location with appropriate width, depth, and corner radius.',
			'Cut a snap ring retaining groove along the outer diameter.',
			'Add a relief undercut at the shoulder transition.'
		]
	},
	{
		id: 'add_chamfer',
		name: '+ Add Chamfer / Bevel / Lead-In',
		category: 'Add New Feature',
		description: 'Create a new edge bevel or conical lead-in on outer/inner corners',
		sourceType: 'add_new',
		shape: 'cylinder',
		isExistingGeometry: false,
		quickPrompts: [
			'Add a 45° chamfer to the outer entrance edge.',
			'Add lead-in chamfers to both ends of the shaft.',
			'Add a 1.5mm x 45° lead-in chamfer to the bore entrance.'
		]
	},
	{
		id: 'add_fillet',
		name: '+ Add Fillet / Corner Round',
		category: 'Add New Feature',
		description: 'Add a new blend radius or rounded internal/external corner',
		sourceType: 'add_new',
		shape: 'box',
		isExistingGeometry: false,
		quickPrompts: [
			'Add smooth blend fillets to all internal shoulder transitions.',
			'Apply a round fillet to the base junction.',
			'Add corner blend radii to reduce stress concentration at step transitions.'
		]
	},
	{
		id: 'add_bore',
		name: '+ Add Hole / Stepped Bore / Counterbore',
		category: 'Add New Feature',
		description: 'Add a central through-hole, blind bore, or counterbored cavity',
		sourceType: 'add_new',
		shape: 'cylinder',
		isExistingGeometry: false,
		quickPrompts: [
			'Add a central through-bore along the main axis.',
			'Add counterbored mounting holes patterned across the flange face.',
			'Cut an internal stepped bore matching the drawing callouts.'
		]
	},
	{
		id: 'add_thread',
		name: '+ Add Thread (Internal / External)',
		category: 'Add New Feature',
		description: 'Add ISO metric or imperial threads to a shaft or hole',
		sourceType: 'add_new',
		shape: 'cylinder',
		isExistingGeometry: false,
		quickPrompts: [
			'Add standard metric ISO thread to the external shaft tip.',
			'Model internal tapped threads inside the central bore.',
			'Add M10x1.5 thread specifications with standard thread relief.'
		]
	},
	{
		id: 'add_pocket_slot',
		name: '+ Add Pocket / Slot / Keyway',
		category: 'Add New Feature',
		description: 'Add drive keyways, flat milled slots, or internal pockets',
		sourceType: 'add_new',
		shape: 'box',
		isExistingGeometry: false,
		quickPrompts: [
			'Add a drive keyway slot along the shaft.',
			'Cut a milled pocket with specified corner radii.',
			'Add open U-shaped slots around the perimeter.'
		]
	}
];

function formatFeatureType(type: string): string {
	const raw = String(type || '').toLowerCase();
	if (raw.includes('hole') || raw.includes('bore') || raw.includes('counterbore')) return 'Hole / Bore';
	if (raw.includes('pocket')) return 'Pocket';
	if (raw.includes('groove') || raw.includes('undercut')) return 'Groove / Undercut';
	if (raw.includes('boss') || raw.includes('stud')) return 'Boss / Stud';
	if (raw.includes('step') || raw.includes('shoulder')) return 'Step / Shoulder';
	if (raw.includes('slot') || raw.includes('keyway')) return 'Slot / Keyway';
	if (raw.includes('chamfer')) return 'Chamfer';
	if (raw.includes('fillet')) return 'Fillet / Blend';
	if (raw.includes('thread')) return 'Thread';
	if (raw.includes('face') || raw.includes('plane')) return 'Planar Face';
	if (raw.includes('cylinder')) return 'Cylinder';
	return type.charAt(0).toUpperCase() + type.slice(1);
}

function cleanParamLabel(key: string): string {
	return key
		.replace(/_/g, ' ')
		.replace(/\b\w/g, (c) => c.toUpperCase());
}

const DIM_SUFFIX_REGEX = /(?:_|-)?(?:height|width|length|depth|thickness|thick|diameter|dia|radius|rad|offset|spacing|count|pitch|angle|chamfer|fillet|size|span|od|id|dist|distance|x|y|z|len|w|h|l|r|d)$/i;

/**
 * Extracts the base component / physical part name from a parameter key.
 * e.g.
 * - 'shell_height', 'shell_width', 'shell_length', 'shell_wall_thickness' -> 'Shell'
 * - 'base_plate_length', 'base_plate_width', 'base_plate_thickness' -> 'Base Plate'
 * - 'boss_1_dia', 'boss_1_height' -> 'Boss 1'
 * - 'mounting_hole_dia', 'mounting_hole_pitch' -> 'Mounting Holes'
 * - 'groove_width', 'groove_depth' -> 'Groove'
 */
function extractComponentBaseName(key: string, meta?: any): { baseName: string; category: string } {
	if (meta?.component) {
		return { baseName: cleanParamLabel(meta.component), category: meta.category || 'Component' };
	}
	if (meta?.group) {
		return { baseName: cleanParamLabel(meta.group), category: meta.category || 'Component' };
	}

	const rawKey = key.trim();
	let stripped = rawKey.replace(DIM_SUFFIX_REGEX, '').trim();

	// If stripping ended up on trailing underscores or numbers without prefix
	stripped = stripped.replace(/_+$/, '');

	// If stripped is empty (e.g. key was just 'length', 'height', 'dia', 'diameter')
	if (!stripped) {
		const lKey = rawKey.toLowerCase();
		if (lKey.includes('dia') || lKey.includes('radius') || lKey.includes('shaft')) {
			return { baseName: 'Main Shaft', category: 'Profile Geometry' };
		}
		return { baseName: 'Main Body', category: 'Global Dimensions' };
	}

	// Handle common multi-level suffixes (e.g. shell_wall_thickness -> shell_wall -> Shell)
	if (stripped.toLowerCase().endsWith('_wall') || stripped.toLowerCase().endsWith('_plate') || stripped.toLowerCase().endsWith('_body')) {
		const parent = stripped.replace(/(?:_wall|_plate|_body)$/i, '');
		if (parent && parent.length > 2) {
			stripped = parent;
		}
	}

	const clean = cleanParamLabel(stripped);
	let category = meta?.category || 'Component Geometry';

	const l = clean.toLowerCase();
	if (l.includes('shell')) category = 'Shell Body';
	else if (l.includes('groove') || l.includes('undercut') || l.includes('o_ring')) category = 'Subtractive Profile';
	else if (l.includes('bore') || l.includes('hole')) category = 'Internal Features';
	else if (l.includes('boss') || l.includes('flange') || l.includes('stud')) category = 'External Features';
	else if (l.includes('pocket') || l.includes('slot')) category = 'Milling Features';
	else if (l.includes('fillet') || l.includes('chamfer')) category = 'Edge Treatments';
	else if (l.includes('base')) category = 'Base / Foundation';

	return { baseName: clean, category };
}

/**
 * Dynamically derives the list of active targetable portions directly from
 * active B-Rep features, model parameters, parameter metadata, and 3D annotations.
 */
export function deriveTargetPortions({
	parameters = {},
	parameterMetadata = {},
	annotations = {},
	camFeatures = [],
	geometryInfo = null,
}: {
	parameters?: Record<string, unknown>;
	parameterMetadata?: Record<string, any>;
	annotations?: Record<string, AnnotationEntry | { p1: [number, number, number]; p2: [number, number, number]; center?: [number, number, number]; type?: string }>;
	camFeatures?: CamFeature[];
	geometryInfo?: StlGeometryInfo | null;
}): {
	existingPortions: TargetPortion[];
	newFeaturePortions: TargetPortion[];
	allPortions: TargetPortion[];
} {
	const existingPortions: TargetPortion[] = [];
	const seenIds = new Set<string>();

	// ── 1. Derive from recognized B-Rep CAM Features ────────────────────────
	if (Array.isArray(camFeatures) && camFeatures.length > 0) {
		for (const feat of camFeatures) {
			if (!feat || !feat.id) continue;
			const id = `brep_${feat.id}`;
			if (seenIds.has(id)) continue;
			seenIds.add(id);

			const featType = formatFeatureType(feat.type);
			const featName = feat.name || feat.groupName || `${featType} (${feat.id.replace(/^feat_/, '#')})`;
			const dims = feat.dimensions || {};
			const dimDesc = Object.entries(dims)
				.map(([k, v]) => `${cleanParamLabel(k)}: ${typeof v === 'number' ? v.toFixed(1) : v}mm`)
				.join(' · ');

			const loc: [number, number, number] | undefined = feat.location || feat.center || feat.position?.center;

			const isCylindrical = /hole|bore|boss|stud|cylinder|step|groove|undercut|thread/i.test(feat.type);

			const quickPrompts: string[] = [
				`Revise the ${featName} (${dimDesc ? dimDesc : featType}): `,
				`Adjust dimensions for ${featName} to match the revised blueprint specifications.`,
				`Verify the tolerances and placement of ${featName}.`
			];

			existingPortions.push({
				id,
				name: featName,
				category: `B-Rep: ${featType}`,
				description: dimDesc || `Recognized ${featType} on 3D geometry`,
				sourceType: 'brep_feature',
				shape: isCylindrical ? 'cylinder' : 'box',
				isExistingGeometry: true,
				location: loc,
				center: loc,
				axis: feat.axis,
				dimensions: dims,
				quickPrompts
			});
		}
	}

	// ── 2. Derive from Parametric Component Groups ──────────────────────────
	const paramEntries = Object.entries(parameters);
	if (paramEntries.length > 0) {
		const componentMap: Record<string, {
			keys: string[];
			values: Record<string, number>;
			category: string;
			loc?: [number, number, number];
		}> = {};

		for (const [key, rawVal] of paramEntries) {
			const meta = parameterMetadata?.[key] || {};
			const val = typeof rawVal === 'number' ? rawVal : parseFloat(String(rawVal)) || 0;
			
			const { baseName, category } = extractComponentBaseName(key, meta);

			if (!componentMap[baseName]) {
				componentMap[baseName] = { keys: [], values: {}, category };
			}
			componentMap[baseName].keys.push(key);
			componentMap[baseName].values[key] = val;
		}

		for (const [compName, data] of Object.entries(componentMap)) {
			const id = `param_${compName.toLowerCase().replace(/\s+/g, '_')}`;
			if (seenIds.has(id)) continue;
			seenIds.add(id);

			// Match with annotations if available
			let matchedLoc: [number, number, number] | undefined = undefined;
			let matchedBox: [number, number, number] | undefined = undefined;
			if (annotations) {
				for (const [annKey, ann] of Object.entries(annotations)) {
					const lAnn = annKey.toLowerCase();
					const isMatchingAnn = data.keys.some((k) => lAnn.includes(k.toLowerCase())) ||
						lAnn.includes(compName.toLowerCase());
					if (isMatchingAnn) {
						if ('center' in ann && ann.center) matchedLoc = ann.center;
						else if (ann.p1 && ann.p2) {
							matchedLoc = [
								(ann.p1[0] + ann.p2[0]) / 2,
								(ann.p1[1] + ann.p2[1]) / 2,
								(ann.p1[2] + ann.p2[2]) / 2,
							];
							matchedBox = [
								Math.max(Math.abs(ann.p2[0] - ann.p1[0]), 3),
								Math.max(Math.abs(ann.p2[1] - ann.p1[1]), 3),
								Math.max(Math.abs(ann.p2[2] - ann.p1[2]), 3),
							];
						}
						break;
					}
				}
			}

			// Format clean dimension summary (e.g. "Length: 100 · Width: 60 · Height: 40")
			const dimSummary = Object.entries(data.values)
				.map(([k, v]) => {
					const shortKey = k.replace(new RegExp(`^${compName}_?`, 'i'), '');
					return `${cleanParamLabel(shortKey || k)}: ${v}mm`;
				})
				.join(' · ');

			const isCylindrical = /bore|hole|boss|shaft|collar|groove|undercut|thread|stud/i.test(compName);

			existingPortions.push({
				id,
				name: compName,
				category: data.category,
				description: dimSummary,
				sourceType: 'parameter_group',
				shape: isCylindrical ? 'cylinder' : 'box',
				isExistingGeometry: true,
				location: matchedLoc,
				center: matchedLoc,
				boxSize: matchedBox,
				parameterKeys: data.keys,
				dimensions: data.values,
				quickPrompts: [
					`Update ${compName} dimensions (${dimSummary}): `,
					`Increase ${cleanParamLabel(data.keys[0])} of ${compName} to `,
					`Refine the ${compName} geometry according to the drawing callouts.`
				]
			});
		}
	}

	// ── 3. Fallback to Whole Model if no features derived ────────────────────
	if (existingPortions.length === 0) {
		existingPortions.push({
			id: 'body_envelope',
			name: 'Main Body / Overall Dimensions',
			category: 'Global Dimensions',
			description: 'Overall geometry, bounding envelope and primary prismoid dimensions',
			sourceType: 'brep_feature',
			shape: 'box',
			isExistingGeometry: true,
			quickPrompts: [
				'Total part length should be exactly as dimensioned in the callout.',
				'Adjust outer dimensions to match the primary datum.',
				'Correct the overall thickness of the main body as specified.'
			]
		});
	}

	return {
		existingPortions,
		newFeaturePortions: ADD_NEW_FEATURE_TEMPLATES,
		allPortions: [...existingPortions, ...ADD_NEW_FEATURE_TEMPLATES],
	};
}
