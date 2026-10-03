'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { Target, X } from 'lucide-react';
import type { TargetPortion } from '@/lib/derive-target-portions';
import type { StlGeometryInfo } from '@/components/viewport/StlMesh';
import type { AnnotationEntry } from '@/components/viewport/DimensionOverlay';

type TargetPortion3DHighlightProps = {
	targetPortion: TargetPortion;
	geometryInfo: StlGeometryInfo;
	annotations?: Record<string, AnnotationEntry>;
	onClear?: () => void;
};

export function TargetPortion3DHighlight({
	targetPortion,
	geometryInfo,
	annotations,
	onClear,
}: TargetPortion3DHighlightProps) {
	const pulseRef = useRef<THREE.Group>(null);
	const lineRef = useRef<THREE.LineSegments>(null);

	const isAddNew = targetPortion.isExistingGeometry === false;
	const themeColor = isAddNew ? '#f59e0b' : '#06b6d4';
	const emissiveColor = isAddNew ? '#fbbf24' : '#22d3ee';

	// Compute spatial zone, bounding box, and geometry alignment
	const {
		center,
		isCylindrical,
		radius,
		span,
		boxDimensions,
		quaternion,
		hudYOffset,
	} = useMemo(() => {
		const bounds = geometryInfo.bounding_box || { min: [-20, -20, -20], max: [20, 20, 20] };
		const [minX, minY, minZ] = bounds.min;
		const [maxX, maxY, maxZ] = bounds.max;
		const dx = Math.max(1, maxX - minX);
		const dy = Math.max(1, maxY - minY);
		const dz = Math.max(1, maxZ - minZ);

		// Determine primary axis of whole part
		let primaryAxis: 'x' | 'y' | 'z' = 'z';
		let maxLen = dz;
		let outerRad = Math.max(dx, dy) / 2;

		if (dx >= dy && dx >= dz) {
			primaryAxis = 'x';
			maxLen = dx;
			outerRad = Math.max(dy, dz) / 2;
		} else if (dy >= dx && dy >= dz) {
			primaryAxis = 'y';
			maxLen = dy;
			outerRad = Math.max(dx, dz) / 2;
		}

		// Helper to scan dimensions dictionary for dimensional keywords regardless of prefix
		const scanDim = (patterns: RegExp[]): number | undefined => {
			if (!targetPortion.dimensions) return undefined;
			for (const [k, v] of Object.entries(targetPortion.dimensions)) {
				const val = typeof v === 'number' ? v : parseFloat(String(v));
				if (isNaN(val) || val <= 0) continue;
				for (const p of patterns) {
					if (p.test(k)) return val;
				}
			}
			return undefined;
		};

		const diaVal = scanDim([/diameter/i, /dia$/i, /radius/i, /rad$/i, /od$/i, /id$/i]);
		const lenVal = scanDim([/length/i, /len$/i, /^l$/i, /x_span/i, /_x$/i]);
		const widthVal = scanDim([/width/i, /w$/i, /y_span/i, /_y$/i]);
		const heightVal = scanDim([/height/i, /depth/i, /thickness/i, /thick/i, /h$/i, /z_span/i, /_z$/i]);

		// Check if annotations match target portion
		let matchedPts: [number, number, number][] = [];
		const portionId = targetPortion.id.toLowerCase();
		const portionName = targetPortion.name.toLowerCase();

		if (annotations) {
			for (const [key, ann] of Object.entries(annotations)) {
				const lkey = key.toLowerCase();
				const isMatch =
					lkey.includes(portionId.replace(/^(param_|brep_|ann_)/, '')) ||
					lkey.includes(portionName) ||
					(targetPortion.parameterKeys && targetPortion.parameterKeys.some(k => lkey.includes(k.toLowerCase())));

				if (isMatch) {
					if (ann.center) matchedPts.push(ann.center);
					if (ann.p1) matchedPts.push(ann.p1);
					if (ann.p2) matchedPts.push(ann.p2);
				}
			}
		}

		// Check cylindrical vs box
		const isWholeModel = portionId.includes('body_envelope') || portionName.includes('whole model') || portionName.includes('overall');
		const cylindricalCheck = !isWholeModel && (
			targetPortion.shape === 'cylinder' ||
			Boolean(diaVal) ||
			/bore|hole|boss|shaft|collar|groove|undercut|thread|cylinder|stud/i.test(portionId) ||
			/bore|hole|boss|shaft|collar|groove|undercut|thread|cylinder|stud/i.test(portionName)
		);

		let cx = (minX + maxX) / 2;
		let cy = (minY + maxY) / 2;
		let cz = (minZ + maxZ) / 2;

		let computedRad = diaVal ? (diaVal / 2) * 1.05 : outerRad * 0.95;
		let computedSpan = heightVal || lenVal || Math.max(maxLen * 0.22, 4);

		let boxX = lenVal ? Math.min(lenVal * 1.02, dx * 1.02) : Math.max(dx * 0.5, 4);
		let boxY = widthVal ? Math.min(widthVal * 1.02, dy * 1.02) : Math.max(dy * 0.5, 4);
		let boxZ = heightVal ? Math.min(heightVal * 1.02, dz * 1.02) : Math.max(dz * 0.5, 4);

		if (isWholeModel) {
			// Frame entire model
			boxX = Math.max(dx * 1.02, 4);
			boxY = Math.max(dy * 1.02, 4);
			boxZ = Math.max(dz * 1.02, 4);
			computedRad = outerRad * 1.05;
			computedSpan = maxLen * 1.02;
		} else if (targetPortion.boxSize) {
			// Exact box size attached from matched annotations
			boxX = targetPortion.boxSize[0];
			boxY = targetPortion.boxSize[1];
			boxZ = targetPortion.boxSize[2];
			if (targetPortion.location || targetPortion.center) {
				const loc = targetPortion.location || targetPortion.center!;
				cx = loc[0];
				cy = loc[1];
				cz = loc[2];
			}
		} else if (matchedPts.length >= 2) {
			// Compute tight bounding box of matched annotation points
			const minAnnX = Math.min(...matchedPts.map(p => p[0]));
			const maxAnnX = Math.max(...matchedPts.map(p => p[0]));
			const minAnnY = Math.min(...matchedPts.map(p => p[1]));
			const maxAnnY = Math.max(...matchedPts.map(p => p[1]));
			const minAnnZ = Math.min(...matchedPts.map(p => p[2]));
			const maxAnnZ = Math.max(...matchedPts.map(p => p[2]));

			cx = (minAnnX + maxAnnX) / 2;
			cy = (minAnnY + maxAnnY) / 2;
			cz = (minAnnZ + maxAnnZ) / 2;

			boxX = Math.max(maxAnnX - minAnnX, 4);
			boxY = Math.max(maxAnnY - minAnnY, 4);
			boxZ = Math.max(maxAnnZ - minAnnZ, 4);
			computedSpan = Math.max(maxAnnZ - minAnnZ, 4);
			computedRad = Math.max((maxAnnX - minAnnX) / 2, (maxAnnY - minAnnY) / 2, 2);
		} else if (targetPortion.location || targetPortion.center) {
			const loc = targetPortion.location || targetPortion.center!;
			cx = loc[0];
			cy = loc[1];
			cz = loc[2];
		} else {
			// Localize along the primary axis for known sub-features without explicit coordinates
			if (primaryAxis === 'z') {
				if (/groove|undercut|o_ring/i.test(portionName) || /groove|undercut|o_ring/i.test(portionId)) {
					cz = minZ + maxLen * 0.45;
					computedSpan = heightVal || widthVal || Math.max(maxLen * 0.12, 3);
				} else if (/chamfer|bevel|lead/i.test(portionName) || /chamfer|bevel|lead/i.test(portionId)) {
					cz = maxZ - maxLen * 0.05;
					computedSpan = heightVal || Math.max(maxLen * 0.08, 2);
				} else if (/collar|shoulder|step/i.test(portionName) || /collar|shoulder|step/i.test(portionId)) {
					cz = minZ + maxLen * 0.22;
					computedSpan = heightVal || Math.max(maxLen * 0.18, 4);
				} else if (/boss|stud/i.test(portionName) || /boss|stud/i.test(portionId)) {
					cz = maxZ - (computedSpan / 2);
				} else if (/bore|hole|counterbore/i.test(portionName) || /bore|hole|counterbore/i.test(portionId)) {
					cz = (minZ + maxZ) / 2;
					computedRad = diaVal ? diaVal / 2 : outerRad * 0.45;
				}
			} else if (primaryAxis === 'x') {
				if (/groove|undercut|o_ring/i.test(portionName) || /groove|undercut|o_ring/i.test(portionId)) {
					cx = minX + maxLen * 0.45;
					computedSpan = lenVal || widthVal || Math.max(maxLen * 0.12, 3);
				} else if (/chamfer|bevel|lead/i.test(portionName) || /chamfer|bevel|lead/i.test(portionId)) {
					cx = maxX - maxLen * 0.05;
					computedSpan = lenVal || Math.max(maxLen * 0.08, 2);
				} else if (/collar|shoulder|step/i.test(portionName) || /collar|shoulder|step/i.test(portionId)) {
					cx = minX + maxLen * 0.22;
					computedSpan = lenVal || Math.max(maxLen * 0.18, 4);
				} else if (/boss|stud/i.test(portionName) || /boss|stud/i.test(portionId)) {
					cx = maxX - (computedSpan / 2);
				} else if (/bore|hole|counterbore/i.test(portionName) || /bore|hole|counterbore/i.test(portionId)) {
					cx = (minX + maxX) / 2;
					computedRad = diaVal ? diaVal / 2 : outerRad * 0.45;
				}
			}
		}

		// Calculate alignment quaternion
		let effectiveAxis = targetPortion.axis;
		let targetVec: THREE.Vector3;
		if (effectiveAxis && Array.isArray(effectiveAxis) && effectiveAxis.length === 3) {
			targetVec = new THREE.Vector3(effectiveAxis[0], effectiveAxis[1], effectiveAxis[2]).normalize();
			if (targetVec.lengthSq() < 0.1) {
				targetVec = primaryAxis === 'x' ? new THREE.Vector3(1, 0, 0) : primaryAxis === 'y' ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(0, 0, 1);
			}
		} else {
			targetVec = primaryAxis === 'x' 
				? new THREE.Vector3(1, 0, 0)
				: primaryAxis === 'y'
					? new THREE.Vector3(0, 1, 0)
					: new THREE.Vector3(0, 0, 1);
		}

		const upVec = new THREE.Vector3(0, 1, 0);
		const quat = new THREE.Quaternion().setFromUnitVectors(upVec, targetVec);

		const hudOffset = cylindricalCheck
			? computedRad + 8
			: Math.max(boxY, boxZ) / 2 + 8;

		return {
			center: [cx, cy, cz] as [number, number, number],
			isCylindrical: cylindricalCheck,
			radius: computedRad,
			span: computedSpan,
			boxDimensions: [boxX, boxY, boxZ] as [number, number, number],
			quaternion: quat,
			hudYOffset: hudOffset,
		};
	}, [targetPortion, geometryInfo, annotations]);

	// Wireframe edges geometry for box framing
	const boxEdgesGeo = useMemo(() => {
		if (isCylindrical) return null;
		const boxGeo = new THREE.BoxGeometry(boxDimensions[0], boxDimensions[1], boxDimensions[2]);
		return new THREE.EdgesGeometry(boxGeo);
	}, [isCylindrical, boxDimensions]);

	// Gentle pulse animation
	useFrame((state) => {
		const t = state.clock.getElapsedTime();
		const pulse = 1 + Math.sin(t * 3) * 0.025;
		if (pulseRef.current) {
			pulseRef.current.scale.set(pulse, pulse, pulse);
		}
	});

	return (
		<group position={center}>
			<group ref={pulseRef}>
				{isCylindrical ? (
					/* ── Cylindrical Feature Framing ────────────────────────────────── */
					<group quaternion={quaternion}>
						{/* Subtle Inner Glow Volume */}
						<mesh>
							<cylinderGeometry args={[radius, radius, span, 36, 1, true]} />
							<meshBasicMaterial
								color={themeColor}
								transparent
								opacity={0.08}
								side={THREE.DoubleSide}
								depthWrite={false}
							/>
						</mesh>

						{/* Top Guide Ring */}
						<mesh position={[0, span / 2, 0]} rotation={[Math.PI / 2, 0, 0]}>
							<ringGeometry args={[radius * 0.98, radius * 1.03, 40]} />
							<meshBasicMaterial color={emissiveColor} transparent opacity={0.8} side={THREE.DoubleSide} />
						</mesh>

						{/* Bottom Guide Ring */}
						<mesh position={[0, -span / 2, 0]} rotation={[Math.PI / 2, 0, 0]}>
							<ringGeometry args={[radius * 0.98, radius * 1.03, 40]} />
							<meshBasicMaterial color={emissiveColor} transparent opacity={0.8} side={THREE.DoubleSide} />
						</mesh>

						{/* Subtle Center Reticle Ring */}
						<mesh position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
							<ringGeometry args={[radius * 1.01, radius * 1.03, 40]} />
							<meshBasicMaterial color={emissiveColor} transparent opacity={0.5} side={THREE.DoubleSide} />
						</mesh>
					</group>
				) : (
					/* ── Prismatic / Box Feature Framing ───────────────────────────── */
					<group>
						{/* Subtle Translucent Inner Glass Volume */}
						<mesh>
							<boxGeometry args={boxDimensions} />
							<meshBasicMaterial
								color={themeColor}
								transparent
								opacity={0.06}
								depthWrite={false}
							/>
						</mesh>

						{/* Crisp Glowing Bounding Box Wireframe Edges */}
						{boxEdgesGeo && (
							<lineSegments geometry={boxEdgesGeo} ref={lineRef}>
								<lineBasicMaterial color={emissiveColor} transparent opacity={0.7} linewidth={1.5} />
							</lineSegments>
						)}
					</group>
				)}
			</group>

			{/* ── Minimalist Holographic Floating HUD Badge ───────────────────── */}
			<Html
				position={[0, hudYOffset, 0]}
				center
				distanceFactor={22}
				className="pointer-events-auto select-none z-50"
			>
				<div className="flex items-center gap-1.5 px-3 py-1 rounded-full bg-[#070b14]/90 border border-cyan-400/40 shadow-[0_0_16px_rgba(6,182,212,0.35)] backdrop-blur-xl whitespace-nowrap text-white text-[11px] font-sans animate-in fade-in zoom-in-95 duration-150">
					<div className="flex items-center gap-1.5 font-mono">
						<span className="relative flex size-2">
							<span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-cyan-400 opacity-75" />
							<span className="relative inline-flex rounded-full size-2 bg-cyan-500" />
						</span>
						<span className="text-[9px] font-extrabold uppercase tracking-wider text-cyan-400">
							{targetPortion.isExistingGeometry === false ? 'NEW FEATURE' : 'TARGET'}
						</span>
					</div>

					<span className="text-zinc-500">|</span>

					<span className="font-semibold text-white truncate max-w-[160px]">
						{targetPortion.name}
					</span>

					{onClear && (
						<button
							type="button"
							onClick={(e) => {
								e.stopPropagation();
								onClear();
							}}
							className="ml-1 p-0.5 rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
							title="Clear target focus"
						>
							<X className="size-3" />
						</button>
					)}
				</div>
			</Html>
		</group>
	);
}
