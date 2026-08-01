import { useEffect, useRef, useState } from 'react';
import { useThree, useFrame } from '@react-three/fiber';
import { CameraControls } from '@react-three/drei';
import * as THREE from 'three';

type ViewportControllerProps = {
	modelGroupRef?: React.RefObject<THREE.Group | null>;
	geometryInfo: any | null;
	activeFeatureId: string | null;
	camFeatures: any[];
	hasStl: boolean;
	workflowStage: string;
	onReset?: () => void;
};

export function ViewportController({
	modelGroupRef,
	geometryInfo,
	activeFeatureId,
	camFeatures,
	hasStl,
	workflowStage,
}: ViewportControllerProps) {
	const controlsRef = useRef<any>(null);
	const { camera, scene, size } = useThree();
	const [hasFramed, setHasFramed] = useState(false);
	const [isAutoRotating, setIsAutoRotating] = useState(false);

	// Stop auto-rotation when user interacts
	useEffect(() => {
		const stopAutoRotate = (e: Event) => {
			// Don't stop if the event originated from outside the canvas (like clicking UI buttons)
			if ((e.target as HTMLElement).tagName !== 'CANVAS') return;
			setIsAutoRotating(false);
		};
		
		window.addEventListener('pointerdown', stopAutoRotate);
		window.addEventListener('wheel', stopAutoRotate, { passive: true });
		
		return () => {
			window.removeEventListener('pointerdown', stopAutoRotate);
			window.removeEventListener('wheel', stopAutoRotate);
		};
	}, []);

	useFrame((state, delta) => {
		if (isAutoRotating && controlsRef.current) {
			controlsRef.current.azimuthAngle += 0.5 * delta;
		}
	});

	// Adaptive clipping planes
	useEffect(() => {
		if (geometryInfo?.bounding_box) {
			const { min, max } = geometryInfo.bounding_box;
			const sizeX = max[0] - min[0];
			const sizeY = max[1] - min[1];
			const sizeZ = max[2] - min[2];
			const maxDim = Math.max(sizeX, sizeY, sizeZ);
			
			// Set near and far based on model size to prevent clipping
			camera.near = Math.max(0.1, maxDim * 0.01);
			camera.far = Math.max(1000, maxDim * 10);
			camera.updateProjectionMatrix();
		}
	}, [geometryInfo, camera]);

	// Auto-framing on load
	useEffect(() => {
		if (!controlsRef.current || !hasStl) return;
		if (hasFramed) return;

		const timer = setTimeout(() => {
			let box: THREE.Box3;
			if (modelGroupRef?.current) {
				box = new THREE.Box3().setFromObject(modelGroupRef.current);
			} else if (geometryInfo?.bounding_box) {
				const { min, max } = geometryInfo.bounding_box;
				box = new THREE.Box3(
					new THREE.Vector3(min[0], min[1], min[2]),
					new THREE.Vector3(max[0], max[1], max[2])
				);
			} else {
				return;
			}

			if (box.isEmpty()) return;

			// Expand box to ensure comfortable framing (prevents "too close" view)
			const sizeVec = new THREE.Vector3();
			box.getSize(sizeVec);
			const maxDim = Math.max(sizeVec.x, sizeVec.y, sizeVec.z);
			box.expandByScalar(maxDim * 0.4);

			// Frame the entire model dynamically
			controlsRef.current.fitToBox(box, true, { paddingLeft: 0.1, paddingRight: 0.1, paddingBottom: 0.2, paddingTop: 0.1 });
			
			// Set a professional isometric angle
			controlsRef.current.rotateTo(Math.PI / 4, Math.PI / 4, true);

			setHasFramed(true);
		}, 150); // Short delay to allow AnimatedSetupGroup to slerp near its target

		return () => clearTimeout(timer);
	}, [geometryInfo, hasStl, hasFramed, modelGroupRef]);

	// Feature selection focus
	useEffect(() => {
		if (!controlsRef.current || !activeFeatureId || !camFeatures) return;

		const feature = camFeatures.find(f => f.id === activeFeatureId);
		if (feature && feature.boundingBox) {
			const { min, max } = feature.boundingBox;
			const box = new THREE.Box3(
				new THREE.Vector3(min.x, min.y, min.z),
				new THREE.Vector3(max.x, max.y, max.z)
			);
			// 20% margin for features as requested
			controlsRef.current.fitToBox(box, true, { paddingLeft: 0.2, paddingRight: 0.2, paddingBottom: 0.2, paddingTop: 0.2 });
		}
	}, [activeFeatureId, camFeatures]);

	// Listen to custom window events for toolbar actions
	useEffect(() => {
		const handleViewportAction = (e: CustomEvent) => {
			if (!controlsRef.current) return;
			const action = e.detail;
			
			if (action === 'fit') {
				let box: THREE.Box3 | null = null;
				if (modelGroupRef?.current) {
					box = new THREE.Box3().setFromObject(modelGroupRef.current);
				} else if (geometryInfo?.bounding_box) {
					const { min, max } = geometryInfo.bounding_box;
					box = new THREE.Box3(
						new THREE.Vector3(min[0], min[1], min[2]),
						new THREE.Vector3(max[0], max[1], max[2])
					);
				}
				if (box && !box.isEmpty()) {
					const sizeVec = new THREE.Vector3();
					box.getSize(sizeVec);
					const maxDim = Math.max(sizeVec.x, sizeVec.y, sizeVec.z);
					box.expandByScalar(maxDim * 0.4);
					controlsRef.current.fitToBox(box, true, { paddingLeft: 0.1, paddingRight: 0.1, paddingBottom: 0.2, paddingTop: 0.1 });
				}
			} else if (action === 'iso') {
				controlsRef.current.rotateTo(Math.PI / 4, Math.PI / 4, true);
			} else if (action === 'front') {
				controlsRef.current.rotateTo(0, Math.PI / 2, true);
			} else if (action === 'back') {
				controlsRef.current.rotateTo(Math.PI, Math.PI / 2, true);
			} else if (action === 'top') {
				controlsRef.current.rotateTo(0, 0, true);
			} else if (action === 'bottom') {
				controlsRef.current.rotateTo(0, Math.PI, true);
			} else if (action === 'left') {
				controlsRef.current.rotateTo(-Math.PI / 2, Math.PI / 2, true);
			} else if (action === 'right') {
				controlsRef.current.rotateTo(Math.PI / 2, Math.PI / 2, true);
			} else if (action === 'auto-rotate') {
				setIsAutoRotating(prev => !prev);
			} else if (action === 'reset' || action === 'home') {
				let box: THREE.Box3 | null = null;
				if (modelGroupRef?.current) {
					box = new THREE.Box3().setFromObject(modelGroupRef.current);
				} else if (geometryInfo?.bounding_box) {
					const { min, max } = geometryInfo.bounding_box;
					box = new THREE.Box3(
						new THREE.Vector3(min[0], min[1], min[2]),
						new THREE.Vector3(max[0], max[1], max[2])
					);
				}
				if (box && !box.isEmpty()) {
					const sizeVec = new THREE.Vector3();
					box.getSize(sizeVec);
					const maxDim = Math.max(sizeVec.x, sizeVec.y, sizeVec.z);
					box.expandByScalar(maxDim * 0.4);
					controlsRef.current.fitToBox(box, true, { paddingLeft: 0.1, paddingRight: 0.1, paddingBottom: 0.2, paddingTop: 0.1 });
					controlsRef.current.rotateTo(Math.PI / 4, Math.PI / 4, true);
				}
			}
		};

		window.addEventListener('viewport-action', handleViewportAction as EventListener);
		return () => window.removeEventListener('viewport-action', handleViewportAction as EventListener);
	}, [geometryInfo]);

	return (
		<CameraControls 
			ref={controlsRef} 
			makeDefault 
			minDistance={0.1}
			maxDistance={10000}
			smoothTime={0.4} // Adds cinematic easing
			draggingSmoothTime={0.1}
		/>
	);
}
