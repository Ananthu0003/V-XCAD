'use client';

import React, { useState, useMemo } from 'react';
import * as THREE from 'three';
import { Line } from '@react-three/drei';

interface SubShapeRaycasterProps {
  topology: any | null;
  selectedEntity: any | null;
  onSelectEntity: (entity: any) => void;
  hoveredEntity?: any | null;
  onHoverEntity?: (entity: any | null) => void;
}

export function SubShapeRaycaster({
  topology,
  selectedEntity,
  onSelectEntity,
  hoveredEntity,
  onHoverEntity
}: SubShapeRaycasterProps) {
  const [localHovered, setLocalHovered] = useState<string | null>(null);

  const activeHover = hoveredEntity?.transient_id || localHovered;

  if (!topology) return null;

  const faces = Object.values(topology.faces || {}) as any[];
  const edges = Object.values(topology.edges || {}) as any[];

  return (
    <group name="sub-shape-raycaster">
      {/* 1. Face Pickers / Highlights */}
      {faces.map((face) => {
        const isSelected = selectedEntity?.transient_id === face.transient_id;
        const isHovered = activeHover === face.transient_id;
        const centroid = face.centroid || [0, 0, 0];
        const normal = face.normal || [0, 0, 1];

        // Determine face dimensions from bounding box
        const bbox = face.bounding_box || { min: [-10, -10, -10], max: [10, 10, 10] };
        const dx = Math.max(2, Math.abs(bbox.max[0] - bbox.min[0]));
        const dy = Math.max(2, Math.abs(bbox.max[1] - bbox.min[1]));
        const dz = Math.max(2, Math.abs(bbox.max[2] - bbox.min[2]));
        const size = Math.max(dx, dy, dz);

        return (
          <group 
            key={face.transient_id} 
            position={new THREE.Vector3(...centroid)}
            onPointerOver={(e) => {
              e.stopPropagation();
              setLocalHovered(face.transient_id);
              onHoverEntity?.(face);
            }}
            onPointerOut={(e) => {
              e.stopPropagation();
              setLocalHovered(null);
              onHoverEntity?.(null);
            }}
            onClick={(e) => {
              e.stopPropagation();
              onSelectEntity(face);
            }}
          >
            {/* Interactive Face Centroid Marker & Normal Indicator */}
            <mesh visible={isSelected || isHovered}>
              <sphereGeometry args={[isSelected ? 0.8 : 0.5, 16, 16]} />
              <meshBasicMaterial 
                color={isSelected ? "#a855f7" : "#3b82f6"} 
                depthTest={false} 
                transparent 
                opacity={0.9} 
              />
            </mesh>

            {/* Selection Halo Ring */}
            {isSelected && (
              <mesh rotation={[Math.PI / 2, 0, 0]}>
                <ringGeometry args={[1.2, 1.6, 32]} />
                <meshBasicMaterial color="#a855f7" depthTest={false} transparent opacity={0.8} side={THREE.DoubleSide} />
              </mesh>
            )}
          </group>
        );
      })}

      {/* 2. Edge Pickers / Highlights */}
      {edges.map((edge) => {
        const isSelected = selectedEntity?.transient_id === edge.transient_id;
        const isHovered = activeHover === edge.transient_id;
        const bbox = edge.bounding_box || { min: [0, 0, 0], max: [0, 0, 0] };
        const p1: [number, number, number] = bbox.min as [number, number, number];
        const p2: [number, number, number] = bbox.max as [number, number, number];

        return (
          <group
            key={edge.transient_id}
            onPointerOver={(e) => {
              e.stopPropagation();
              setLocalHovered(edge.transient_id);
              onHoverEntity?.(edge);
            }}
            onPointerOut={(e) => {
              e.stopPropagation();
              setLocalHovered(null);
              onHoverEntity?.(null);
            }}
            onClick={(e) => {
              e.stopPropagation();
              onSelectEntity(edge);
            }}
          >
            {/* Visual 3D Edge Line Overlay (Highlighted on hover/select) */}
            {(isSelected || isHovered) && (
              <Line
                points={[p1, p2]}
                color={isSelected ? "#ec4899" : "#f59e0b"}
                lineWidth={isSelected ? 4 : 3}
                transparent
                opacity={1.0}
                depthTest={false}
              />
            )}

            {/* Centroid Selection Dot */}
            <mesh position={new THREE.Vector3(...(edge.centroid || [0, 0, 0]))} visible={isSelected || isHovered}>
              <sphereGeometry args={[isSelected ? 0.6 : 0.4, 12, 12]} />
              <meshBasicMaterial color={isSelected ? "#ec4899" : "#f59e0b"} depthTest={false} transparent opacity={0.9} />
            </mesh>
          </group>
        );
      })}
    </group>
  );
}
