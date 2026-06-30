'use client';

import { useMemo } from 'react';
import { useLoader } from '@react-three/fiber';
import { STLLoader } from 'three-stdlib';
import { Box3, BufferGeometry, Color, MeshStandardMaterial, Vector3 } from 'three';

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
};

export function StlMesh({ url, onGeometryReady }: StlMeshProps) {
	const geometry = useLoader(STLLoader, url);

	const { centeredGeometry, scale, center } = useMemo(() => {
		const cloned = geometry.clone() as BufferGeometry;
		cloned.computeVertexNormals();
		cloned.computeBoundingBox();

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
			new MeshStandardMaterial({
				color: new Color('#e4e4e7'),
				metalness: 0.2,
				roughness: 0.3,
				flatShading: false,
			}),
		[]
	);

	return <mesh geometry={centeredGeometry} material={material} scale={scale} castShadow receiveShadow />;
}
