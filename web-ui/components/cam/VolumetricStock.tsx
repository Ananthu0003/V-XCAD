import React, { useRef, useMemo, useEffect } from 'react';
import * as THREE from 'three';
import { useFrame } from '@react-three/fiber';
import { SimulationState, ToolpathSegment, Tool as CamTool } from '@/types/cam';

interface VolumetricStockProps {
    stockType?: string;
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
            
            const moveType = segment.move_type || (segment as any).moveType || (segment as any).type || '';
            const moveTypeStr = String(moveType).toLowerCase();
            // Check if segment is a non-cutting move (rapid clearance, rapid XY, retract)
            if (moveTypeStr.includes('rapid') || moveTypeStr.includes('retract')) {
                continue; // Rapid and retract moves don't cut stock
            }
            
            const toolId = segment.tool_id || (segment as any).toolId;
            const cleanId = (id: any) => String(id || '').trim().toLowerCase().replace(/^t0*/, 't');
            const segToolClean = cleanId(toolId);
            const tool = camTools.find(t => {
                if (!t) return false;
                const tId = cleanId(t.id);
                const tName = cleanId(t.name);
                const tToolName = cleanId((t as any).tool_name);
                const tNum = (t as any).tool_number !== undefined ? `t${(t as any).tool_number}` : '';
                return tId === segToolClean || tName === segToolClean || tToolName === segToolClean || (tNum && tNum === segToolClean);
            }) || camTools[0];
            if (!tool) continue;
            
            const rawDiameter = tool.diameter || (tool as any).diameter_mm || 6;
            const toolDiameter = setupUnits === 'in' ? rawDiameter / 25.4 : rawDiameter;
            const toolRadius = toolDiameter / 2;
            const toolRadiusSq = toolRadius * toolRadius;

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
            
            // Check if this is an arc move (arc_cw, arc_ccw)
            const isArc = moveTypeStr.includes('arc') || (segment as any).center || (segment as any).center_x !== undefined;
            const centerX = (segment as any).center?.x ?? (segment as any).center_x;
            const centerY = (segment as any).center?.y ?? (segment as any).center_y;

            type SubPath = { x1: number; y1: number; z1: number; x2: number; y2: number; z2: number };
            const subPaths: SubPath[] = [];

            if (isArc && centerX !== undefined && centerY !== undefined) {
                const localCenterX = centerX - stockCenter[0];
                const localCenterY = centerY - stockCenter[1];
                const r = (segment as any).radius ?? Math.hypot(localStartX - localCenterX, localStartY - localCenterY);
                if (r > 0.001) {
                    const startAngle = Math.atan2(localStartY - localCenterY, localStartX - localCenterX);
                    const endAngle = Math.atan2(localEndY - localCenterY, localEndX - localCenterX);
                    const isCW = moveTypeStr === 'arc_cw' || (segment as any).clockwise === true;
                    let sweep = endAngle - startAngle;
                    if (isCW) {
                        if (sweep >= -1e-6) sweep -= 2 * Math.PI;
                    } else {
                        if (sweep <= 1e-6) sweep += 2 * Math.PI;
                    }

                    const steps = Math.max(8, Math.min(32, Math.ceil(Math.abs(sweep) / (Math.PI / 8))));
                    let prevX = localStartX;
                    let prevY = localStartY;
                    let prevZ = localStartZ;
                    for (let s = 1; s <= steps; s++) {
                        const frac = s / steps;
                        const curAngle = startAngle + frac * sweep;
                        const curX = s === steps ? localEndX : (localCenterX + r * Math.cos(curAngle));
                        const curY = s === steps ? localEndY : (localCenterY + r * Math.sin(curAngle));
                        const curZ = localStartZ + frac * (localEndZ - localStartZ);
                        subPaths.push({ x1: prevX, y1: prevY, z1: prevZ, x2: curX, y2: curY, z2: curZ });
                        prevX = curX;
                        prevY = curY;
                        prevZ = curZ;
                    }
                } else {
                    subPaths.push({ x1: localStartX, y1: localStartY, z1: localStartZ, x2: localEndX, y2: localEndY, z2: localEndZ });
                }
            } else {
                subPaths.push({ x1: localStartX, y1: localStartY, z1: localStartZ, x2: localEndX, y2: localEndY, z2: localEndZ });
            }

            // Carve each subpath
            for (const sub of subPaths) {
                const minX = Math.min(sub.x1, sub.x2) - toolRadius;
                const maxX = Math.max(sub.x1, sub.x2) + toolRadius;
                const minY = Math.min(sub.y1, sub.y2) - toolRadius;
                const maxY = Math.max(sub.y1, sub.y2) + toolRadius;
                
                const l2 = (sub.x2 - sub.x1) ** 2 + (sub.y2 - sub.y1) ** 2;

                // Iterate over the grid
                for (let v = 0; v < positionAttr.count; v++) {
                    const vx = positionAttr.getX(v);
                    const vy = positionAttr.getY(v);
                    
                    // Broad phase check
                    if (vx < minX || vx > maxX || vy < minY || vy > maxY) continue;
                    
                    // Distance to line segment (swept circle)
                    let t = 0;
                    if (l2 !== 0) {
                        t = ((vx - sub.x1) * (sub.x2 - sub.x1) + (vy - sub.y1) * (sub.y2 - sub.y1)) / l2;
                        t = Math.max(0, Math.min(1, t));
                    }
                    
                    const projX = sub.x1 + t * (sub.x2 - sub.x1);
                    const projY = sub.y1 + t * (sub.y2 - sub.y1);
                    
                    const distSq = (vx - projX) ** 2 + (vy - projY) ** 2;
                    
                    if (distSq <= toolRadiusSq) {
                        // It's inside the tool sweep!
                        // Interpolate Z depth along the segment
                        const targetZ = sub.z1 + t * (sub.z2 - sub.z1);
                        
                        // We only cut DOWN, so if the tool is lower than current stock, update it
                        if (targetZ < heightMap.current[v]) {
                            heightMap.current[v] = targetZ;
                            positionAttr.setZ(v, targetZ);
                            needsUpdate = true;
                        }
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
                    onBeforeCompile={(shader) => {
                        const isCylStock = String(stockType || '').toLowerCase().includes('cylin') || String(stockType || '').toLowerCase().includes('bar');
                        if (isCylStock) {
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
            {(String(stockType || '').toLowerCase().includes('cylin') || String(stockType || '').toLowerCase().includes('bar')) ? (
                <>
                    <mesh rotation={[Math.PI / 2, 0, 0]}>
                        <cylinderGeometry args={[stockDimensions[0] / 2, stockDimensions[0] / 2, stockDimensions[2], 64, 1, true]} />
                        <meshStandardMaterial color="#94a3b8" metalness={0.6} roughness={0.4} side={THREE.DoubleSide} />
                    </mesh>
                    <mesh position={[0, -stockDimensions[2] / 2, 0]} rotation={[Math.PI / 2, 0, 0]}>
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
