import React, { useRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { SimulationState, ToolpathSegment, Tool as CamTool } from '@/types/cam';

interface VolumetricStockProps {
    stockType?: 'box' | 'cylinder';
    stockCenter: [number, number, number];
    stockDimensions: [number, number, number];
    simulationState: SimulationState;
    camTools: CamTool[];
    resolution?: number; // e.g., 256 for a 256x256 grid
    wcsOffset?: [number, number, number];
    setupUnits?: 'mm' | 'in';
}

export function VolumetricStock({ 
    stockType = 'box',
    stockCenter, 
    stockDimensions, 
    simulationState, 
    camTools,
    resolution = 256,
    wcsOffset = [0, 0, 0],
    setupUnits = 'mm'
}: VolumetricStockProps) {
    const geometryRef = useRef<THREE.PlaneGeometry>(null);
    const lastRenderedSegment = useRef<number>(-1);
    const heightMap = useRef<Float32Array | null>(null);

    // Create the geometry only once
    const planeArgs = useMemo(() => {
        // PlaneGeometry args: [width, height, widthSegments, heightSegments]
        // Since CAD Z is up, width = CAD X (dimensions[0]), height = CAD Y (dimensions[1])
        return [stockDimensions[0], stockDimensions[1], resolution, resolution] as const;
    }, [stockDimensions[0], stockDimensions[1], resolution]);

    // Initialize heightmap data
    useEffect(() => {
        if (!geometryRef.current) return;
        const positionAttr = geometryRef.current.attributes.position;
        // heightMap stores the Z values
        heightMap.current = new Float32Array(positionAttr.count);
        
        // Initial stock surface is at +Z of the stock block
        const topZ = stockDimensions[2] / 2; // relative to center
        
        for (let i = 0; i < positionAttr.count; i++) {
            heightMap.current[i] = topZ;
            // The PlaneGeometry is in XY plane by default. We will set Z to topZ.
            positionAttr.setZ(i, topZ);
        }
        
        positionAttr.needsUpdate = true;
        geometryRef.current.computeVertexNormals();
        
        // Reset simulation tracking when geometry reinitializes
        lastRenderedSegment.current = -1;
    }, [stockDimensions, resolution]);

    // Handle toolpath carving
    useFrame(() => {
        if (!geometryRef.current || !heightMap.current || !simulationState.segments) return;
        if (simulationState.activeSegmentIndex === undefined || simulationState.activeSegmentIndex === lastRenderedSegment.current) return;
        if (!simulationState.isPlaying && simulationState.activeSegmentIndex === lastRenderedSegment.current) return;
        
        const positionAttr = geometryRef.current.attributes.position;
        const segments = simulationState.segments;
        
        // If simulation is rewound, we need to rebuild the mesh from scratch
        if (simulationState.activeSegmentIndex < lastRenderedSegment.current) {
            const topZ = stockDimensions[2] / 2;
            for (let i = 0; i < positionAttr.count; i++) {
                heightMap.current[i] = topZ;
                positionAttr.setZ(i, topZ);
            }
            lastRenderedSegment.current = -1;
        }

        let needsUpdate = false;
        
        // Process all segments from last rendered up to current active
        const startIndex = lastRenderedSegment.current + 1;
        const endIndex = simulationState.activeSegmentIndex;
        
        // Prevent processing too many segments in a single frame to avoid freezing
        const maxSegmentsPerFrame = 50;
        const actualEndIndex = Math.min(endIndex, startIndex + maxSegmentsPerFrame);
        
        for (let i = startIndex; i <= actualEndIndex; i++) {
            const segment = segments[i];
            if (!segment) continue;
            
            const moveType = segment.move_type || (segment as any).type;
            // Check if segment is a cutting move
            if (moveType === 'rapid') {
                continue; // Rapid moves don't cut (ideally)
            }
            
            const toolId = segment.tool_id;
            const tool = camTools.find(t => t.id === toolId || t.name === toolId || (t as any).tool_name === toolId);
            if (!tool) continue;
            
            const rawDiameter = tool.diameter || (tool as any).diameter_mm || 6;
            const toolDiameter = setupUnits === 'in' ? rawDiameter / 25.4 : rawDiameter;
            const toolRadius = toolDiameter / 2;
            // Segment coordinates (in setup space)
            const startX = (segment as any).start?.x ?? segment.start_x ?? 0;
            const startY = (segment as any).start?.y ?? segment.start_y ?? 0;
            const startZ = (segment as any).start?.z ?? segment.start_z ?? 0;
            
            const endX = (segment as any).end?.x ?? segment.end_x ?? 0;
            const endY = (segment as any).end?.y ?? segment.end_y ?? 0;
            const endZ = (segment as any).end?.z ?? segment.end_z ?? 0;
            
            // To make carving relative to the plane geometry (which is centered at stockCenter)
            // we must translate the segment coords into the local space of the PlaneGeometry.
            const localStartX = startX - stockCenter[0];
            const localStartY = startY - stockCenter[1];
            const localStartZ = startZ - stockCenter[2];
            
            const localEndX = endX - stockCenter[0];
            const localEndY = endY - stockCenter[1];
            const localEndZ = endZ - stockCenter[2];
            
            // Calculate 2D bounding box of the swept path to optimize vertex checking
            const minX = Math.min(localStartX, localEndX) - toolRadius;
            const maxX = Math.max(localStartX, localEndX) + toolRadius;
            const minY = Math.min(localStartY, localEndY) - toolRadius;
            const maxY = Math.max(localStartY, localEndY) + toolRadius;
            
            const gridWidth = stockDimensions[0];
            const gridHeight = stockDimensions[1];
            
            // Iterate over the grid
            for (let v = 0; v < positionAttr.count; v++) {
                const vx = positionAttr.getX(v);
                const vy = positionAttr.getY(v);
                
                // Broad phase check
                if (vx < minX || vx > maxX || vy < minY || vy > maxY) continue;
                
                // Distance to line segment (swept circle)
                const l2 = (localEndX - localStartX) ** 2 + (localEndY - localStartY) ** 2;
                let t = 0;
                if (l2 !== 0) {
                    t = ((vx - localStartX) * (localEndX - localStartX) + (vy - localStartY) * (localEndY - localStartY)) / l2;
                    t = Math.max(0, Math.min(1, t));
                }
                
                const projX = localStartX + t * (localEndX - localStartX);
                const projY = localStartY + t * (localEndY - localStartY);
                
                const distSq = (vx - projX) ** 2 + (vy - projY) ** 2;
                
                if (distSq <= toolRadius * toolRadius) {
                    // It's inside the tool sweep!
                    // Interpolate Z depth along the segment
                    const targetZ = localStartZ + t * (localEndZ - localStartZ);
                    
                    // We only cut DOWN, so if the tool is lower than current stock, update it
                    if (targetZ < heightMap.current[v]) {
                        heightMap.current[v] = targetZ;
                        positionAttr.setZ(v, targetZ);
                        needsUpdate = true;
                    }
                }
            }
        }
        
        lastRenderedSegment.current = actualEndIndex;
        
        if (needsUpdate) {
            positionAttr.needsUpdate = true;
            geometryRef.current.computeVertexNormals();
        }
    });

    // Pre-calculate the box materials to avoid conditional hooks
    const boxMaterials = useMemo(() => [
        new THREE.MeshStandardMaterial({ color: "#94a3b8", metalness: 0.6, roughness: 0.4 }), // Right
        new THREE.MeshStandardMaterial({ color: "#94a3b8", metalness: 0.6, roughness: 0.4 }), // Left
        new THREE.MeshStandardMaterial({ color: "#94a3b8", metalness: 0.6, roughness: 0.4 }), // Front
        new THREE.MeshStandardMaterial({ color: "#94a3b8", metalness: 0.6, roughness: 0.4 }), // Back
        new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false }), // Top (Invisible)
        new THREE.MeshStandardMaterial({ color: "#94a3b8", metalness: 0.6, roughness: 0.4 })  // Bottom
    ], []);

    return (
        <group position={stockCenter}>
            <mesh>
                <planeGeometry ref={geometryRef} args={planeArgs} />
                <meshStandardMaterial 
                    key={`${stockType}-${stockDimensions.join('-')}`}
                    customProgramCacheKey={() => `${stockType}-${stockDimensions[0]}`}
                    color="#94a3b8" 
                    metalness={0.6} 
                    roughness={0.4} 
                    side={THREE.DoubleSide}
                    onBeforeCompile={(shader) => {
                        if (stockType === 'cylinder') {
                            shader.uniforms.uRadius = { value: stockDimensions[0] / 2 };
                            
                            shader.vertexShader = `
                                varying vec3 vLocalPos;
                                ${shader.vertexShader}
                            `.replace(
                                `#include <begin_vertex>`,
                                `#include <begin_vertex>
                                 vLocalPos = position;`
                            );
                            
                            shader.fragmentShader = `
                                varying vec3 vLocalPos;
                                uniform float uRadius;
                                ${shader.fragmentShader}
                            `.replace(
                                /void\s+main\s*\(\s*\)\s*\{/,
                                `void main() {
                                 if (length(vLocalPos.xy) > uRadius) discard;`
                            );
                        }
                    }}
                />
            </mesh>
            {/* 
                The plane only acts as the top surface of the stock. 
                For a true volumetric look, we render an inverted box as the "walls" 
                of the stock block so you can't see through the bottom/sides.
            */}
            {/* 
                Use a single BoxGeometry for the solid walls/bottom.
                In Three.js, BoxGeometry faces are: 0: +X, 1: -X, 2: +Y, 3: -Y, 4: +Z (Top), 5: -Z (Bottom)
                We use a memoized array of materials to hide the top face.
            */}
            {stockType === 'cylinder' ? (
                <>
                    <mesh rotation={[Math.PI / 2, 0, 0]}>
                        <cylinderGeometry args={[stockDimensions[0] / 2, stockDimensions[0] / 2, stockDimensions[2], 64, 1, true]} />
                        <meshStandardMaterial color="#94a3b8" metalness={0.6} roughness={0.4} side={THREE.DoubleSide} />
                    </mesh>
                    <mesh position={[0, 0, -stockDimensions[2] / 2]}>
                        <circleGeometry args={[stockDimensions[0] / 2, 64]} />
                        <meshStandardMaterial color="#94a3b8" metalness={0.6} roughness={0.4} side={THREE.DoubleSide} />
                    </mesh>
                </>
            ) : (
                <mesh 
                    position={[0, 0, 0]} 
                    material={boxMaterials}
                >
                    <boxGeometry args={[stockDimensions[0], stockDimensions[1], stockDimensions[2]]} />
                </mesh>
            )}
        </group>
    );
}
