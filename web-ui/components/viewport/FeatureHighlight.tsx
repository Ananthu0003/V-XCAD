'use client';

import React, { useMemo, useEffect, useRef } from 'react';
import { Edges, Html } from '@react-three/drei';
import { Vector3, Quaternion, MeshBasicMaterial, LineBasicMaterial, MathUtils } from 'three';
import { useFrame } from '@react-three/fiber';

type AnnotationEntry = {
	p1: [number, number, number];
	p2: [number, number, number];
};

type FeatureHighlightProps = {
	annotations: Record<string, AnnotationEntry>;
	camFeatures?: any[];
	parameters?: Record<string, unknown>;
	activeParameter: string | null;
	geometryScale: number;
	geometryCenter: [number, number, number];
	debugMode?: boolean;
	onDebugInfo?: (info: any) => void;
};

export function FeatureHighlight({
	annotations,
	camFeatures,
	parameters,
	activeParameter,
	geometryScale,
	debugMode = false,
	onDebugInfo,
}: FeatureHighlightProps) {
	if (!activeParameter) {
		if (onDebugInfo) onDebugInfo(null);
		return null;
	}

	const highlightData = useMemo(() => {
		// First check annotations (blueprint dimensions)
		if (annotations && annotations[activeParameter] && annotations[activeParameter].p1) {
			const p1 = annotations[activeParameter].p1;
			const p2 = annotations[activeParameter].p2;
			const transformedP1 = new Vector3(p1[0] * geometryScale, p1[1] * geometryScale, p1[2] * geometryScale);
			const transformedP2 = new Vector3(p2[0] * geometryScale, p2[1] * geometryScale, p2[2] * geometryScale);
			const width = Math.abs(transformedP2.x - transformedP1.x) || 0.1;
			const height = Math.abs(transformedP2.y - transformedP1.y) || 0.1;
			const depth = Math.abs(transformedP2.z - transformedP1.z) || 0.1;
			const pos = new Vector3().addVectors(transformedP1, transformedP2).multiplyScalar(0.5);
			
			const paramName = activeParameter.toLowerCase();
			const isCylindrical = paramName.includes('hole') || paramName.includes('diameter') || paramName.includes('radius') || paramName.includes('cylinder') || paramName.includes('shaft') || paramName.includes('bore');

			if (isCylindrical) {
				const diffXY = Math.abs(width - height);
				const diffYZ = Math.abs(height - depth);
				const diffXZ = Math.abs(width - depth);
				
				let axisVec = new Vector3(0, 0, 1);
				let radius = width / 2;
				let cylinderDepth = depth;
				
				if (diffXY < diffYZ && diffXY < diffXZ) {
					// X and Y are closest, so Z is the axis
					axisVec = new Vector3(0, 0, 1);
					radius = (width + height) / 4;
					cylinderDepth = depth;
				} else if (diffYZ < diffXY && diffYZ < diffXZ) {
					// Y and Z are closest, so X is the axis
					axisVec = new Vector3(1, 0, 0);
					radius = (height + depth) / 4;
					cylinderDepth = width;
				} else {
					// X and Z are closest, so Y is the axis
					axisVec = new Vector3(0, 1, 0);
					radius = (width + depth) / 4;
					cylinderDepth = height;
				}
				
				const quat = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), axisVec);
				
				return { 
					shape: 'cylinder', 
					args: [radius, radius, cylinderDepth, 32], 
					position: pos, 
					quaternion: quat,
					debug: { type: 'Annotation (Cylinder)', id: activeParameter, axis: [axisVec.x, axisVec.y, axisVec.z] }
				};
			}

			return { 
				shape: 'box', 
				args: [width, height, depth], 
				position: pos, 
				quaternion: new Quaternion(),
				debug: { type: 'Annotation', id: activeParameter }
			};
		}

		// Then check CAM Features
		if (camFeatures) {
			let feat = camFeatures.find(f => f.id === activeParameter);
			
			// If activeParameter is an Extracted Parameter (not found by ID), try matching by dimension value
			if (!feat && parameters && parameters[activeParameter] !== undefined) {
				const paramValue = parameters[activeParameter];
				if (typeof paramValue === 'number') {
					const paramName = activeParameter.toLowerCase();
					const isDiameter = paramName.includes('dia');
					const isHeight = paramName.includes('height') || paramName.includes('depth') || paramName.includes('len');
					
					feat = camFeatures.find(f => {
						if (!f.dimensions) return false;
						if (isDiameter) {
							return Math.abs((f.dimensions.diameter || 0) - paramValue) < 0.01 || 
								   Math.abs((f.dimensions.radius || 0) * 2 - paramValue) < 0.01 ||
								   Math.abs((f.dimensions.width || 0) - paramValue) < 0.01;
						}
						if (isHeight) {
							return Math.abs((f.dimensions.depth || 0) - paramValue) < 0.01 || 
								   Math.abs((f.dimensions.height || 0) - paramValue) < 0.01 || 
								   Math.abs((f.dimensions.length || 0) - paramValue) < 0.01;
						}
						// Fallback match any dimension
						return Object.values(f.dimensions).some((v: any) => Math.abs(Number(v) - paramValue) < 0.01);
					});
				}
			}

			if (feat) {
				const featType = (feat.type || feat.name || '').toLowerCase();
				const isCylindrical = featType.includes('hole') || featType.includes('cylinder') || featType.includes('shaft') || featType.includes('bore') || feat.dimensions?.diameter !== undefined;

				const featCenter = feat.location || feat.center || feat.position?.center;
				let pos = new Vector3();
				let p1: [number, number, number] | undefined;
				let p2: [number, number, number] | undefined;
				
				if (featCenter) {
					pos = new Vector3(featCenter[0] * geometryScale, featCenter[1] * geometryScale, featCenter[2] * geometryScale);
				} else if (feat.position?.bounding_box) {
					p1 = feat.position.bounding_box.min;
					p2 = feat.position.bounding_box.max;
					if (p1 && p2) {
						pos = new Vector3(p1[0] + p2[0], p1[1] + p2[1], p1[2] + p2[2]).multiplyScalar(0.5 * geometryScale);
					}
				}

				// Determine rotation
				const ax = feat.axis || [0, 0, 1]; // Default Z axis
				const axis = new Vector3(ax[0], ax[1], ax[2]).normalize();
				// Three.js Cylinder is Y-up, so rotate Y to match feature axis
				const quat = new Quaternion().setFromUnitVectors(new Vector3(0, 1, 0), axis);
				
				const debugInfo = {
					id: feat.id,
					type: feat.type || feat.name,
					center: featCenter,
					axis: feat.axis,
					dimensions: feat.dimensions,
					bounding_box: feat.position?.bounding_box,
					p1, p2
				};

				if (isCylindrical && feat.dimensions) {
					const radius = (feat.dimensions.diameter || (feat.dimensions.radius * 2) || feat.dimensions.width || 20) / 2;
					const depth = (feat.dimensions.depth || feat.dimensions.height || feat.dimensions.length || 20);
					
					return {
						shape: 'cylinder',
						args: [radius * geometryScale, radius * geometryScale, depth * geometryScale, 32],
						position: pos,
						quaternion: quat,
						debug: debugInfo
					};
				}

				// Fallback to Box if not cylindrical or lacking precise dimensions
				// If it's an outer profile, see if we have explicit dimensions
				if (feat.dimensions && (feat.dimensions.width || feat.dimensions.length || feat.dimensions.height)) {
					const width = (feat.dimensions.width || 20) * geometryScale;
					const length = (feat.dimensions.length || 20) * geometryScale;
					const height = (feat.dimensions.height || 20) * geometryScale;
					// For box, we typically use width, height, depth in Three.js
					return {
						shape: 'box',
						args: [width, height, length],
						position: pos,
						quaternion: quat,
						debug: debugInfo
					};
				}
				
				if (feat.position?.bounding_box) {
					p1 = feat.position.bounding_box.min;
					p2 = feat.position.bounding_box.max;
					if (p1 && p2) {
						const width = Math.abs(p2[0] - p1[0]) * geometryScale;
						const height = Math.abs(p2[1] - p1[1]) * geometryScale;
						const depth = Math.abs(p2[2] - p1[2]) * geometryScale;
						return {
							shape: 'box',
							args: [width, height, depth],
							position: pos,
							quaternion: new Quaternion(),
							debug: debugInfo
						};
					}
				}

				// Ultimate fallback with default sizes
				return {
					shape: 'box',
					args: [20 * geometryScale, 20 * geometryScale, 20 * geometryScale],
					position: pos,
					quaternion: quat,
					debug: debugInfo
				};
			}
		}

		return null;
	}, [activeParameter, annotations, camFeatures, geometryScale, parameters]);

	useEffect(() => {
		if (onDebugInfo) {
			onDebugInfo(highlightData?.debug || null);
		}
	}, [highlightData, onDebugInfo]);

	if (!highlightData) return null;
	const { shape, args, position, quaternion } = highlightData;

	return (
		<AnimatedHighlight shape={shape} args={args} position={position} quaternion={quaternion} />
	);
}

function AnimatedHighlight({ shape, args, position, quaternion }: { shape: string, args: any[], position: Vector3, quaternion: Quaternion }) {
	const materialRef = useRef<MeshBasicMaterial>(null);
	const edgesMaterialRef = useRef<LineBasicMaterial>(null);

	useFrame((state, delta) => {
		if (materialRef.current) {
			materialRef.current.opacity = MathUtils.lerp(materialRef.current.opacity, 0.4, delta * 10);
		}
		if (edgesMaterialRef.current) {
			edgesMaterialRef.current.opacity = MathUtils.lerp(edgesMaterialRef.current.opacity, 1.0, delta * 10);
		}
	});

	return (
		<group position={position} quaternion={quaternion}>
			<mesh>
				{shape === 'cylinder' ? (
					<cylinderGeometry args={args as [number, number, number, number]} />
				) : (
					<boxGeometry args={args as [number, number, number]} />
				)}
				<meshBasicMaterial 
					ref={materialRef}
					color="#3b82f6" 
					transparent 
					opacity={0} 
					depthTest={false} 
					side={2}
				/>
				<Edges 
					scale={1.0} 
					threshold={15} 
					color="#2563eb" 
					renderOrder={1000} 
				>
					<lineBasicMaterial ref={edgesMaterialRef} color="#2563eb" transparent opacity={0} depthTest={false} />
				</Edges>
			</mesh>
		</group>
	);
}

