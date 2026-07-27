'use client';

import { useMemo } from 'react';
import { useLoader } from '@react-three/fiber';
import { STLLoader, mergeVertices } from 'three-stdlib';
import { Box3, BufferGeometry, Color, MeshPhysicalMaterial, Vector3 } from 'three';

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
	onGeometryReady?: (info: StlGeometryInfo) => void;
	onMeshClick?: (point: [number, number, number]) => void;
};

export function StlMesh({ url, expectedSize, onGeometryReady, onMeshClick }: StlMeshProps) {
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

	const material = useMemo(
		() =>
			new MeshPhysicalMaterial({
				color: new Color('#a0a5aa'), // realistic machined steel/aluminum color
				metalness: 0.8,
				roughness: 0.25, // low roughness for shiny finish
				clearcoat: 0.3,
				clearcoatRoughness: 0.2,
				flatShading: false,
			}),
		[]
	);

	return (
		<mesh
			geometry={centeredGeometry}
			material={material}
			scale={scale}
			castShadow
			receiveShadow
			onPointerDown={(e) => {
				e.stopPropagation();
				const localPoint = e.object.worldToLocal(e.point.clone());
				onMeshClick?.([localPoint.x, localPoint.y, localPoint.z]);
			}}
		/>
	);
}
