'use client';

import { useMemo } from 'react';
import { useLoader } from '@react-three/fiber';
import { STLLoader, mergeVertices } from 'three-stdlib';
import { Box3, BufferGeometry, Color, DoubleSide, FrontSide, MeshPhysicalMaterial, Vector3 } from 'three';

export type StlGeometryInfo = {
	scale: number;
	center: [number, number, number];
	bounding_box?: {
		min: [number, number, number];
		max: [number, number, number];
	};
};

type StlMeshProps = {
	url: string;
	expectedSize?: number;
	workpieceMaterial?: string;
	xRayMode?: boolean;
	onGeometryReady?: (info: StlGeometryInfo) => void;
	onMeshClick?: (point: [number, number, number]) => void;
	onHover?: (isHovered: boolean) => void;
};

const MATERIAL_PRESETS: Record<string, any> = {
	'aluminum': { color: '#a0a5aa', metalness: 0.8, roughness: 0.35, clearcoat: 0.1 },
	'aluminum_6061': { color: '#a0a5aa', metalness: 0.85, roughness: 0.3, clearcoat: 0.2 },
	'steel': { color: '#7a818c', metalness: 0.9, roughness: 0.4, clearcoat: 0.1 },
	'steel_1018': { color: '#7a818c', metalness: 0.9, roughness: 0.45, clearcoat: 0.1 },
	'titanium': { color: '#888c8d', metalness: 0.8, roughness: 0.5, clearcoat: 0.05 },
	'brass': { color: '#b5a642', metalness: 0.9, roughness: 0.3, clearcoat: 0.4 },
	'copper': { color: '#b87333', metalness: 0.95, roughness: 0.2, clearcoat: 0.3 },
	'plastic': { color: '#f8fafc', metalness: 0.1, roughness: 0.4, clearcoat: 0.5 },
	'delrin': { color: '#f8fafc', metalness: 0.05, roughness: 0.6, clearcoat: 0.1 },
	'acrylic': { color: '#ffffff', metalness: 0.1, roughness: 0.1, clearcoat: 1.0, transmission: 0.9, transparent: true },
};

export function StlMesh({ url, expectedSize, workpieceMaterial, xRayMode = false, onGeometryReady, onMeshClick, onHover }: StlMeshProps) {
	const geometry = useLoader(STLLoader, url);

	const { centeredGeometry, scale, center } = useMemo(() => {
		let cloned = geometry.clone() as BufferGeometry;
		
		try {
			cloned = mergeVertices(cloned);
		} catch (e) {
			console.warn("Could not merge vertices for smooth shading", e);
		}
		
		cloned.computeVertexNormals();
		cloned.computeBoundingBox();
		cloned.computeBoundingSphere();

		const box = cloned.boundingBox ?? new Box3();
		const size = new Vector3();
		box.getSize(size);
		const maxDim = Math.max(size.x, size.y, size.z);

		let safeScale = 1.0;
		// Auto-detect inch vs mm mismatch
		if (expectedSize && maxDim > 0) {
			const ratio = expectedSize / maxDim;
			if (ratio > 15 && ratio < 35) {
				safeScale = 25.4; // Auto-scale inches to mm
			} else if (ratio < 0.06 && ratio > 0.02) {
				safeScale = 1 / 25.4; // Auto-scale mm to inches
			}
		}

		if (safeScale !== 1.0) {
			cloned.scale(safeScale, safeScale, safeScale);
			cloned.computeBoundingBox();
			cloned.computeBoundingSphere();
		}

		const scaledBox = cloned.boundingBox ?? new Box3();
		const centerVec = new Vector3();
		scaledBox.getCenter(centerVec);

		// Notify parent of the computed geometry metrics
		onGeometryReady?.({
			scale: safeScale,
			center: [centerVec.x, centerVec.y, centerVec.z],
			bounding_box: cloned.boundingBox ? {
				min: [cloned.boundingBox.min.x, cloned.boundingBox.min.y, cloned.boundingBox.min.z],
				max: [cloned.boundingBox.max.x, cloned.boundingBox.max.y, cloned.boundingBox.max.z]
			} : undefined
		});

		return {
			centeredGeometry: cloned,
			scale: 1.0, // Scale is baked into geometry
			center: centerVec
		};
	}, [geometry, expectedSize]);

	const material = useMemo(() => {
		const matKey = workpieceMaterial ? workpieceMaterial.toLowerCase().replace(/[^a-z0-9_]/g, '') : 'aluminum_6061';
		let preset = MATERIAL_PRESETS['aluminum_6061'];
		
		for (const key of Object.keys(MATERIAL_PRESETS)) {
			if (matKey.includes(key)) {
				preset = MATERIAL_PRESETS[key];
				break;
			}
		}

		if (xRayMode) {
			return new MeshPhysicalMaterial({
				color: preset.color || '#a0a5aa',
				metalness: 0.1,
				roughness: 0.2,
				transparent: true,
				opacity: 0.25,
				side: DoubleSide,
				depthWrite: false,
				flatShading: false,
				clearcoat: 0.0,
			});
		}

		return new MeshPhysicalMaterial({
			...preset,
			flatShading: false,
			side: FrontSide,
		});
	}, [workpieceMaterial, xRayMode]);

	return (
		<mesh
			geometry={centeredGeometry}
			material={material}
			scale={scale}
			castShadow={!xRayMode}
			receiveShadow={!xRayMode}
			renderOrder={xRayMode ? 1 : 0}
			onPointerDown={(e) => {
				if (!e.shiftKey) return;
				e.stopPropagation();
				const localPoint = e.object.worldToLocal(e.point.clone());
				onMeshClick?.([localPoint.x, localPoint.y, localPoint.z]);
			}}
			onPointerOver={(e) => {
				e.stopPropagation();
				document.body.style.cursor = 'pointer';
				onHover?.(true);
			}}
			onPointerOut={(e) => {
				document.body.style.cursor = 'default';
				onHover?.(false);
			}}
		/>
	);
}
