import React, { Component, ErrorInfo, ReactNode, useMemo, useState, useEffect } from 'react';
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
	workpieceMaterial?: string;
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

class CadMeshErrorBoundary extends Component<{ children: ReactNode; fallback?: ReactNode }, { hasError: boolean }> {
	constructor(props: { children: ReactNode; fallback?: ReactNode }) {
		super(props);
		this.state = { hasError: false };
	}

	static getDerivedStateFromError() {
		return { hasError: true };
	}

	componentDidCatch(error: Error) {
		console.warn('CadMesh loader caught error:', error.message);
	}

	render() {
		if (this.state.hasError) return this.props.fallback || null;
		return this.props.children;
	}
}

function InnerCadMesh({ url, workpieceMaterial, onGeometryReady, onMeshClick, onHover }: StlMeshProps) {
	const [geometry, setGeometry] = useState<BufferGeometry | null>(null);

	useEffect(() => {
		let isMounted = true;
		if (!url) {
			setGeometry(null);
			return;
		}

		fetch(url)
			.then((res) => {
				if (!res.ok) throw new Error(`HTTP ${res.status}`);
				return res.arrayBuffer();
			})
			.then((buffer) => {
				if (!isMounted) return;
				const loader = new STLLoader();
				const parsed = loader.parse(buffer);
				setGeometry(parsed);
			})
			.catch((err) => {
				if (!isMounted) return;
				setGeometry(null);
			});

		return () => {
			isMounted = false;
		};
	}, [url]);

	const processed = useMemo(() => {
		if (!geometry) return null;
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

	const material = useMemo(() => {
		const matKey = workpieceMaterial ? workpieceMaterial.toLowerCase().replace(/[^a-z0-9_]/g, '') : 'aluminum_6061';
		let preset = MATERIAL_PRESETS['aluminum_6061'];
		
		for (const key of Object.keys(MATERIAL_PRESETS)) {
			if (matKey.includes(key)) {
				preset = MATERIAL_PRESETS[key];
				break;
			}
		}

		return new MeshPhysicalMaterial({
			...preset,
			flatShading: false,
		});
	}, [workpieceMaterial]);

	if (!processed?.centeredGeometry) return null;

	return (
		<mesh
			geometry={processed.centeredGeometry}
			material={material}
			scale={processed.scale}
			castShadow
			receiveShadow
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

export function CadMesh(props: StlMeshProps) {
	return (
		<CadMeshErrorBoundary key={props.url}>
			<InnerCadMesh {...props} />
		</CadMeshErrorBoundary>
	);
}
