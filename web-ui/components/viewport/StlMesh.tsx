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
	onGeometryReady?: (info: StlGeometryInfo) => void;
	onMeshClick?: (point: [number, number, number]) => void;
};

export function StlMesh({ url, onGeometryReady, onMeshClick }: StlMeshProps) {
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

		// Do NOT center or scale the mesh. We want true 1:1 CAD coordinates.
		const safeScale = 1.0;
		const centerVec = new Vector3();
		const box = cloned.boundingBox ?? new Box3();
		box.getCenter(centerVec);

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
			scale: safeScale,
			center: centerVec
		};
	}, [geometry]);

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
