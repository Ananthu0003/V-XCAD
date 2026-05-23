'use client';

import { useMemo } from 'react';
import { Html, Line } from '@react-three/drei';
import { Vector3 } from 'three';

type AnnotationEntry = {
	p1: [number, number, number];
	p2: [number, number, number];
};

type DimensionOverlayProps = {
	annotations: Record<string, AnnotationEntry>;
	activeParameter: string | null;
	/** Uniform scale factor applied to the STL mesh */
	geometryScale: number;
	/** The center of the original bounding box (before centering) */
	geometryCenter: [number, number, number];
};

function DimensionLine({
	label,
	p1,
	p2,
	scale,
	center,
}: {
	label: string;
	p1: [number, number, number];
	p2: [number, number, number];
	scale: number;
	center: [number, number, number];
}) {
	// Transform annotation coordinates:
	// 1. Subtract the geometry center (to match geometry.center())
	// 2. Multiply by the same scale factor
	const transformedP1 = useMemo(
		() =>
			new Vector3(
				(p1[0] - center[0]) * scale,
				(p1[1] - center[1]) * scale,
				(p1[2] - center[2]) * scale,
			),
		[p1, center, scale],
	);

	const transformedP2 = useMemo(
		() =>
			new Vector3(
				(p2[0] - center[0]) * scale,
				(p2[1] - center[1]) * scale,
				(p2[2] - center[2]) * scale,
			),
		[p2, center, scale],
	);

	const midpoint = useMemo(
		() =>
			new Vector3().addVectors(transformedP1, transformedP2).multiplyScalar(0.5),
		[transformedP1, transformedP2],
	);

	// Calculate the real-world distance (before scaling)
	const realDistance = useMemo(() => {
		const dx = p2[0] - p1[0];
		const dy = p2[1] - p1[1];
		const dz = p2[2] - p1[2];
		return Math.sqrt(dx * dx + dy * dy + dz * dz);
	}, [p1, p2]);

	// Small offset perpendicular to the line for the endpoints
	const endcapSize = 0.03;

	return (
		<group>
			{/* Main dimension line */}
			<Line
				points={[transformedP1, transformedP2]}
				color="#f59e0b"
				lineWidth={2.5}
				dashed={false}
			/>

			{/* Endpoint markers (small perpendicular lines) */}
			<Line
				points={[
					[transformedP1.x, transformedP1.y - endcapSize, transformedP1.z],
					[transformedP1.x, transformedP1.y + endcapSize, transformedP1.z],
				]}
				color="#f59e0b"
				lineWidth={2}
			/>
			<Line
				points={[
					[transformedP2.x, transformedP2.y - endcapSize, transformedP2.z],
					[transformedP2.x, transformedP2.y + endcapSize, transformedP2.z],
				]}
				color="#f59e0b"
				lineWidth={2}
			/>

			{/* Midpoint sphere marker */}
			<mesh position={midpoint}>
				<sphereGeometry args={[0.02, 16, 16]} />
				<meshBasicMaterial color="#f59e0b" />
			</mesh>

			{/* HTML label at the midpoint */}
			<Html
				position={midpoint}
				center
				style={{
					pointerEvents: 'none',
					userSelect: 'none',
				}}
			>
				<div
					style={{
						background: 'rgba(0,0,0,0.85)',
						border: '1px solid rgba(59,130,246,0.6)',
						borderRadius: '6px',
						padding: '3px 8px',
						display: 'flex',
						flexDirection: 'column',
						alignItems: 'center',
						gap: '1px',
						backdropFilter: 'blur(8px)',
						boxShadow: '0 0 12px rgba(59,130,246,0.15)',
						transform: 'translateY(-24px)',
						whiteSpace: 'nowrap',
					}}
				>
					<span
						style={{
							color: '#f59e0b',
							fontSize: '9px',
							fontWeight: 800,
							letterSpacing: '0.1em',
							textTransform: 'uppercase',
							fontFamily: 'monospace',
						}}
					>
						{label.replace(/_/g, ' ')}
					</span>
					<span
						style={{
							color: '#fafafa',
							fontSize: '11px',
							fontWeight: 700,
							fontFamily: 'monospace',
						}}
					>
						{realDistance.toFixed(2)} mm
					</span>
				</div>
			</Html>
		</group>
	);
}

export function DimensionOverlay({
	annotations,
	activeParameter,
	geometryScale,
	geometryCenter,
}: DimensionOverlayProps) {
	if (!activeParameter || !annotations[activeParameter]) {
		return null;
	}

	const annotation = annotations[activeParameter];

	return (
		<DimensionLine
			label={activeParameter}
			p1={annotation.p1}
			p2={annotation.p2}
			scale={geometryScale}
			center={geometryCenter}
		/>
	);
}
