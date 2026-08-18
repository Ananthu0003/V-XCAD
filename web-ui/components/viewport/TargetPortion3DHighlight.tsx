'use client';

import { useMemo, useRef } from 'react';
import { useFrame } from '@react-three/fiber';
import { Html } from '@react-three/drei';
import * as THREE from 'three';
import { Target, X } from 'lucide-react';
import type { TargetPortion } from '@/components/chat/ChatPanel';
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
	const meshRef = useRef<THREE.Mesh>(null);
	const pulseRef = useRef<THREE.Mesh>(null);
	const ringRef1 = useRef<THREE.Mesh>(null);
	const ringRef2 = useRef<THREE.Mesh>(null);

	// Compute spatial zone for the selected target portion
	const { center, radius, span, axis, quaternion } = useMemo(() => {
		const bounds = geometryInfo.bounding_box || { min: [-20, -20, -20], max: [20, 20, 20] };
		const [minX, minY, minZ] = bounds.min;
		const [maxX, maxY, maxZ] = bounds.max;
		const dx = Math.max(0.1, maxX - minX);
		const dy = Math.max(0.1, maxY - minY);
		const dz = Math.max(0.1, maxZ - minZ);

		// Determine primary axis
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

		// Check if annotations match target portion
		let matchedPts: [number, number, number][] = [];
		const portionId = targetPortion.id.toLowerCase();

		if (annotations) {
			for (const [key, ann] of Object.entries(annotations)) {
				const lkey = key.toLowerCase();
				let isMatch = false;

				if (portionId.includes('groove') || portionId.includes('detail_d')) {
					isMatch = lkey.includes('groove') || lkey.includes('seal') || lkey.includes('undercut') || lkey.includes('o_ring');
				} else if (portionId.includes('chamfer') || portionId.includes('detail_e')) {
					isMatch = lkey.includes('chamfer') || lkey.includes('bevel') || lkey.includes('cone') || lkey.includes('lead');
				} else if (portionId.includes('bore') || portionId.includes('stepped_bore')) {
					isMatch = lkey.includes('bore') || lkey.includes('hole') || lkey.includes('inner') || lkey.includes('id_');
				} else if (portionId.includes('fillet')) {
					isMatch = lkey.includes('fillet') || lkey.includes('radius') || lkey.includes('blend') || lkey.includes('r_');
				} else if (portionId.includes('step') || portionId.includes('collar') || portionId.includes('detail_b')) {
					isMatch = lkey.includes('shoulder') || lkey.includes('collar') || lkey.includes('step') || lkey.includes('dia');
				} else if (portionId.startsWith('param_')) {
					const rawParam = portionId.replace('param_', '');
					isMatch = lkey === rawParam || lkey.includes(rawParam);
				}

				if (isMatch) {
					if (ann.center) matchedPts.push(ann.center);
					if (ann.p1) matchedPts.push(ann.p1);
					if (ann.p2) matchedPts.push(ann.p2);
				}
			}
		}

		let cx = (minX + maxX) / 2;
		let cy = (minY + maxY) / 2;
		let cz = (minZ + maxZ) / 2;
		let computedSpan = maxLen * 0.22;
		let computedRad = outerRad * 1.08;

		if (matchedPts.length > 0) {
			// Center derived from matched annotations
			cx = matchedPts.reduce((acc, p) => acc + p[0], 0) / matchedPts.length;
			cy = matchedPts.reduce((acc, p) => acc + p[1], 0) / matchedPts.length;
			cz = matchedPts.reduce((acc, p) => acc + p[2], 0) / matchedPts.length;
			computedSpan = Math.max(maxLen * 0.15, 8);
		} else {
			// Canonical portion zones along the primary axis
			if (primaryAxis === 'z') {
				if (portionId.includes('groove') || portionId.includes('detail_d')) {
					cz = minZ + maxLen * 0.45;
					computedSpan = maxLen * 0.22;
				} else if (portionId.includes('chamfer') || portionId.includes('detail_e')) {
					cz = maxZ - maxLen * 0.08;
					computedSpan = maxLen * 0.16;
				} else if (portionId.includes('bore') || portionId.includes('stepped_bore')) {
					cz = minZ + maxLen * 0.40;
					computedSpan = maxLen * 0.60;
					computedRad = outerRad * 0.90;
				} else if (portionId.includes('fillet')) {
					cz = minZ + maxLen * 0.28;
					computedSpan = maxLen * 0.16;
				} else if (portionId.includes('step') || portionId.includes('collar') || portionId.includes('detail_b')) {
					cz = minZ + maxLen * 0.20;
					computedSpan = maxLen * 0.20;
					computedRad = outerRad * 1.12;
				} else if (portionId.includes('body')) {
					cz = (minZ + maxZ) / 2;
					computedSpan = maxLen * 1.02;
				}
			} else if (primaryAxis === 'x') {
				if (portionId.includes('groove') || portionId.includes('detail_d')) {
					cx = minX + maxLen * 0.45;
					computedSpan = maxLen * 0.22;
				} else if (portionId.includes('chamfer') || portionId.includes('detail_e')) {
					cx = maxX - maxLen * 0.08;
					computedSpan = maxLen * 0.16;
				} else if (portionId.includes('bore') || portionId.includes('stepped_bore')) {
					cx = minX + maxLen * 0.40;
					computedSpan = maxLen * 0.60;
					computedRad = outerRad * 0.90;
				} else if (portionId.includes('step') || portionId.includes('collar') || portionId.includes('detail_b')) {
					cx = minX + maxLen * 0.20;
					computedSpan = maxLen * 0.20;
					computedRad = outerRad * 1.12;
				} else if (portionId.includes('body')) {
					cx = (minX + maxX) / 2;
					computedSpan = maxLen * 1.02;
				}
			}
		}

		// Calculate alignment quaternion
		const targetVec = primaryAxis === 'x' 
			? new THREE.Vector3(1, 0, 0)
			: primaryAxis === 'y'
				? new THREE.Vector3(0, 1, 0)
				: new THREE.Vector3(0, 0, 1);

		// Three.js CylinderGeometry is oriented along Y by default (height along Y)
		const upVec = new THREE.Vector3(0, 1, 0);
		const quat = new THREE.Quaternion().setFromUnitVectors(upVec, targetVec);

		return {
			center: [cx, cy, cz] as [number, number, number],
			radius: computedRad,
			span: computedSpan,
			axis: primaryAxis,
			quaternion: quat,
		};
	}, [targetPortion, geometryInfo, annotations]);

	// Pulse animation for the 3D highlighting halo
	useFrame((state) => {
		const t = state.clock.getElapsedTime();
		const pulse = 1 + Math.sin(t * 3.5) * 0.06;
		const pulseFast = 1 + Math.sin(t * 6) * 0.04;

		if (pulseRef.current) {
			pulseRef.current.scale.set(pulse, 1, pulse);
		}
		if (ringRef1.current) {
			ringRef1.current.scale.set(pulseFast, pulseFast, 1);
		}
		if (ringRef2.current) {
			ringRef2.current.scale.set(pulseFast, pulseFast, 1);
		}
	});

	return (
		<group position={center}>
			{/* Rotated Group aligning Cylinder with Model Axis */}
			<group quaternion={quaternion}>
				{/* 1. Volumetric Glowing Cylinder Halo */}
				<mesh ref={meshRef}>
					<cylinderGeometry args={[radius, radius, span, 48, 1, true]} />
					<meshStandardMaterial
						color="#06b6d4"
						emissive="#0891b2"
						emissiveIntensity={0.6}
						transparent
						opacity={0.32}
						side={THREE.DoubleSide}
						depthWrite={false}
					/>
				</mesh>

				{/* 2. Pulsing Outer Aura Halo */}
				<mesh ref={pulseRef}>
					<cylinderGeometry args={[radius * 1.05, radius * 1.05, span * 1.02, 36, 1, true]} />
					<meshBasicMaterial
						color="#38bdf8"
						transparent
						opacity={0.18}
						side={THREE.DoubleSide}
						depthWrite={false}
					/>
				</mesh>

				{/* 3. High-Contrast Edge Rings (Top & Bottom Boundaries) */}
				<mesh position={[0, span / 2, 0]} rotation={[Math.PI / 2, 0, 0]}>
					<ringGeometry args={[radius * 0.98, radius * 1.06, 48]} />
					<meshBasicMaterial color="#22d3ee" transparent opacity={0.85} side={THREE.DoubleSide} />
				</mesh>
				<mesh position={[0, -span / 2, 0]} rotation={[Math.PI / 2, 0, 0]}>
					<ringGeometry args={[radius * 0.98, radius * 1.06, 48]} />
					<meshBasicMaterial color="#22d3ee" transparent opacity={0.85} side={THREE.DoubleSide} />
				</mesh>

				{/* 4. Center Guideline Reticle Ring */}
				<mesh position={[0, 0, 0]} rotation={[Math.PI / 2, 0, 0]}>
					<ringGeometry args={[radius * 1.02, radius * 1.05, 48]} />
					<meshBasicMaterial color="#38bdf8" transparent opacity={0.9} side={THREE.DoubleSide} />
				</mesh>
			</group>

			{/* 5. 3D Floating Beacon & Interactive HUD Callout Badge */}
			<Html
				position={[0, radius + 14, 0]}
				center
				distanceFactor={22}
				className="pointer-events-auto select-none"
			>
				<div className="flex flex-col items-center gap-1 animate-in fade-in zoom-in-95 duration-200">
					{/* Glowing HUD Badge */}
					<div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-950/95 border border-cyan-400/80 shadow-[0_0_24px_rgba(6,182,212,0.6)] backdrop-blur-xl ring-1 ring-cyan-500/30 whitespace-nowrap">
						<div className="relative flex size-5 items-center justify-center rounded-full bg-cyan-500/20 text-cyan-400 border border-cyan-400/60 shadow-sm">
							<Target className="size-3 animate-pulse" />
							<span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-cyan-400 animate-ping" />
						</div>

						<div className="flex flex-col">
							<div className="flex items-center gap-1.5">
								<span className="text-[9px] font-black uppercase tracking-widest text-cyan-400 font-mono">
									3D TARGET
								</span>
								<span className="text-[11px] font-black uppercase tracking-wide text-white">
									{targetPortion.name}
								</span>
							</div>
							<span className="text-[9px] text-zinc-400 font-medium leading-none">
								{targetPortion.category} · Ready for feedback
							</span>
						</div>

						{onClear && (
							<button
								type="button"
								onClick={(e) => {
									e.stopPropagation();
									onClear();
								}}
								className="ml-1 p-1 rounded-full text-zinc-400 hover:text-white hover:bg-white/10 transition-colors"
								title="Clear 3D target portion"
							>
								<X className="size-3" />
							</button>
						)}
					</div>

					{/* 3D Vertical Leader Pin to Model Surface */}
					<div className="w-0.5 h-6 bg-gradient-to-b from-cyan-400 to-transparent flex items-center justify-center">
						<div className="size-1.5 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(6,182,212,1)]" />
					</div>
				</div>
			</Html>
		</group>
	);
}
