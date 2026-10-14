'use client';

import React, { useState, useMemo } from 'react';
import * as THREE from 'three';
import { Line, Edges } from '@react-three/drei';

export interface SubShapeRaycasterProps {
  topology: any | null;
  selectedEntity: any | null;
  onSelectEntity: (entity: any, multiSelect?: boolean) => void;
  hoveredEntity?: any | null;
  onHoverEntity?: (entity: any | null) => void;
  selectionMode?: 'body' | 'face' | 'edge' | 'all';
  highlightedFaceIds?: string[] | null;
  detectedFeatures?: any[];
  selectedEntities?: any[];
}

/**
 * Resolves which face was clicked based on intersection point and normal.
 */
export function findFaceFromHit(
  point: [number, number, number],
  normal: [number, number, number] | undefined,
  faces: Record<string, any>
): any | null {
  if (!faces || Object.keys(faces).length === 0) return null;
  const [px, py, pz] = point;
  let bestFace: any = null;
  let bestScore = Infinity;

  for (const face of Object.values(faces)) {
    const bbox = face.bounding_box;
    if (bbox?.min && bbox?.max) {
      const tol = 1.5;
      if (
        px < bbox.min[0] - tol || px > bbox.max[0] + tol ||
        py < bbox.min[1] - tol || py > bbox.max[1] + tol ||
        pz < bbox.min[2] - tol || pz > bbox.max[2] + tol
      ) {
        continue;
      }
    }

    let dist = 0;
    if (face.surface_type === 'plane' && face.normal) {
      const [fnx, fny, fnz] = face.normal;
      if (normal) {
        const dotN = Math.abs(fnx * normal[0] + fny * normal[1] + fnz * normal[2]);
        if (dotN < 0.6) continue;
      }
      if (face.plane_d !== undefined && face.plane_d !== null) {
        dist = Math.abs(fnx * px + fny * py + fnz * pz + face.plane_d);
      } else {
        const [cx, cy, cz] = face.centroid || [0, 0, 0];
        dist = Math.abs(fnx * (px - cx) + fny * (py - cy) + fnz * (pz - cz));
      }
    } else if (face.surface_type === 'cylinder' && face.axis && face.radius) {
      const [ax, ay, az] = face.axis;
      const [cx, cy, cz] = face.centroid || [0, 0, 0];
      const vx = px - cx, vy = py - cy, vz = pz - cz;
      const proj = vx * ax + vy * ay + vz * az;
      const perpX = vx - proj * ax, perpY = vy - proj * ay, perpZ = vz - proj * az;
      const radDist = Math.sqrt(perpX * perpX + perpY * perpY + perpZ * perpZ);
      dist = Math.abs(radDist - face.radius);
    } else {
      const [cx, cy, cz] = face.centroid || [0, 0, 0];
      dist = Math.hypot(px - cx, py - cy, pz - cz) * 0.1;
    }

    const [cx, cy, cz] = face.centroid || [0, 0, 0];
    const centroidDist = Math.hypot(px - cx, py - cy, pz - cz);
    const score = dist * 10 + centroidDist * 0.01;

    if (score < bestScore) {
      bestScore = score;
      bestFace = face;
    }
  }

  return bestFace;
}

function FaceSurfaceMesh({
  face,
  isSelected,
  isHovered,
  onPointerOver,
  onPointerOut,
  onClick
}: {
  face: any;
  isSelected: boolean;
  isHovered: boolean;
  onPointerOver: (e: any) => void;
  onPointerOut: (e: any) => void;
  onClick: (e: any) => void;
}) {
  const geometry = useMemo(() => {
    // 1. Exact B-Rep triangulation if available
    if (face.triangles && face.triangles.length >= 9) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(face.triangles), 3));
      geom.computeVertexNormals();
      return geom;
    }

    // 2. Planar quad patch fallback
    if (face.surface_type === 'plane' && face.normal && face.centroid && face.bounding_box) {
      const normVec = new THREE.Vector3(...face.normal).normalize();
      const tempUp = Math.abs(normVec.y) > 0.9 ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
      const u = new THREE.Vector3().crossVectors(tempUp, normVec).normalize();
      const v = new THREE.Vector3().crossVectors(normVec, u).normalize();

      const bbox = face.bounding_box;
      const minPt = new THREE.Vector3(...(bbox.min || [-5, -5, -5]));
      const maxPt = new THREE.Vector3(...(bbox.max || [5, 5, 5]));
      const center = new THREE.Vector3(...face.centroid);

      const corners = [
        new THREE.Vector3(minPt.x, minPt.y, minPt.z),
        new THREE.Vector3(maxPt.x, minPt.y, minPt.z),
        new THREE.Vector3(maxPt.x, maxPt.y, minPt.z),
        new THREE.Vector3(minPt.x, maxPt.y, minPt.z),
        new THREE.Vector3(minPt.x, minPt.y, maxPt.z),
        new THREE.Vector3(maxPt.x, minPt.y, maxPt.z),
        new THREE.Vector3(maxPt.x, maxPt.y, maxPt.z),
        new THREE.Vector3(minPt.x, maxPt.y, maxPt.z),
      ];

      let uMin = Infinity, uMax = -Infinity;
      let vMin = Infinity, vMax = -Infinity;

      corners.forEach((c) => {
        const d = new THREE.Vector3().subVectors(c, center);
        const uVal = d.dot(u);
        const vVal = d.dot(v);
        if (uVal < uMin) uMin = uVal;
        if (uVal > uMax) uMax = uVal;
        if (vVal < vMin) vMin = vVal;
        if (vVal > vMax) vMax = vMax;
      });

      const p1 = new THREE.Vector3().copy(center).addScaledVector(u, uMin).addScaledVector(v, vMin);
      const p2 = new THREE.Vector3().copy(center).addScaledVector(u, uMax).addScaledVector(v, vMin);
      const p3 = new THREE.Vector3().copy(center).addScaledVector(u, uMax).addScaledVector(v, vMax);
      const p4 = new THREE.Vector3().copy(center).addScaledVector(u, uMin).addScaledVector(v, vMax);

      const positions = new Float32Array([
        p1.x, p1.y, p1.z,  p2.x, p2.y, p2.z,  p3.x, p3.y, p3.z,
        p1.x, p1.y, p1.z,  p3.x, p3.y, p3.z,  p4.x, p4.y, p4.z,
      ]);

      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      geom.computeVertexNormals();
      return geom;
    }

    return null;
  }, [face]);

  if (!geometry) return null;

  return (
    <group>
      <mesh
        geometry={geometry}
        onPointerOver={(e) => {
          e.stopPropagation();
          document.body.style.cursor = 'pointer';
          onPointerOver(e);
        }}
        onPointerOut={(e) => {
          e.stopPropagation();
          document.body.style.cursor = 'default';
          onPointerOut(e);
        }}
        onClick={(e) => {
          e.stopPropagation();
          onClick(e);
        }}
      >
        <meshStandardMaterial
          // Selected: amber fill; Hovered: accent fill (12%); idle: invisible
          color={isSelected ? '#e8a33d' : isHovered ? '#4c7bf4' : '#ffffff'}
          transparent={true}
          opacity={isSelected ? 0.30 : isHovered ? 0.12 : 0.001}
          depthTest={true}
          depthWrite={false}
          side={THREE.DoubleSide}
          polygonOffset={true}
          polygonOffsetFactor={-2}
          polygonOffsetUnits={-2}
          roughness={0.2}
          metalness={0.1}
        />
        {/* Selected: amber 2.5px outline; no outline otherwise */}
        {isSelected && (
          <Edges color="#f5a524" threshold={15} />
        )}
      </mesh>
    </group>
  );
}

export function SubShapeRaycaster({
  topology,
  selectedEntity,
  onSelectEntity,
  hoveredEntity,
  onHoverEntity,
  selectionMode = 'face',
  highlightedFaceIds,
  detectedFeatures,
  selectedEntities,
}: SubShapeRaycasterProps) {
  const [localHovered, setLocalHovered] = useState<string | null>(null);

  const activeHover = hoveredEntity?.transient_id || localHovered;

  if (!topology) return null;

  const faces = Object.values(topology.faces || {}) as any[];
  const edges = Object.values(topology.edges || {}) as any[];

  const showFaces = selectionMode === 'face' || selectionMode === 'all' || selectionMode === 'body';
  const showEdges = selectionMode === 'edge' || selectionMode === 'all';

  const hlFaceSet = useMemo(() => new Set(highlightedFaceIds || []), [highlightedFaceIds]);
  const selectedFaceSet = useMemo(() => {
    const s = new Set<string>();
    if (selectedEntity?.transient_id) s.add(selectedEntity.transient_id);
    if (selectedEntity?.face_ids && Array.isArray(selectedEntity.face_ids)) {
      selectedEntity.face_ids.forEach((fid: string) => s.add(fid));
    }
    if (selectedEntities && Array.isArray(selectedEntities)) {
      selectedEntities.forEach((ent: any) => {
        if (ent?.transient_id) s.add(ent.transient_id);
        if (ent?.face_ids && Array.isArray(ent.face_ids)) {
          ent.face_ids.forEach((fid: string) => s.add(fid));
        }
      });
    }
    return s;
  }, [selectedEntity, selectedEntities]);

  const selectedEdgeSet = useMemo(() => {
    const s = new Set<string>();
    if (selectedEntity?.transient_id) s.add(selectedEntity.transient_id);
    if (selectedEntities && Array.isArray(selectedEntities)) {
      selectedEntities.forEach((ent: any) => {
        if (ent?.transient_id) s.add(ent.transient_id);
      });
    }
    return s;
  }, [selectedEntity, selectedEntities]);

  return (
    <group name="sub-shape-raycaster">
      {/* 1. Interactive 3D Face Meshes */}
      {showFaces && faces.map((face) => {
        const isSelected = selectedFaceSet.has(face.transient_id);
        const isHovered = activeHover === face.transient_id || hlFaceSet.has(face.transient_id);

        return (
          <FaceSurfaceMesh
            key={face.transient_id}
            face={face}
            isSelected={isSelected}
            isHovered={isHovered}
            onPointerOver={() => {
              setLocalHovered(face.transient_id);
              if (selectionMode === 'body') {
                onHoverEntity?.({ entity_type: 'body' });
                return;
              }
              onHoverEntity?.(face);
            }}
            onPointerOut={() => {
              setLocalHovered(null);
              onHoverEntity?.(null);
            }}
            onClick={(e) => {
              if (selectionMode === 'body') {
                e?.stopPropagation?.();
                onSelectEntity({ entity_type: 'body' });
                return;
              }
              const isMulti = e?.nativeEvent?.shiftKey || false;
              onSelectEntity(face, isMulti);
            }}
          />
        );
      })}

      {/* 2. Interactive Edge Highlights — accent selected, accent hover */}
      {showEdges && edges.map((edge) => {
        const isSelected = selectedEdgeSet.has(edge.transient_id);
        const isHovered = activeHover === edge.transient_id;
        const bbox = edge.bounding_box || { min: [0, 0, 0], max: [0, 0, 0] };
        const p1: [number, number, number] = bbox.min as [number, number, number];
        const p2: [number, number, number] = bbox.max as [number, number, number];

        return (
          <group
            key={edge.transient_id}
            onPointerOver={(e) => {
              e.stopPropagation();
              document.body.style.cursor = 'pointer';
              setLocalHovered(edge.transient_id);
              onHoverEntity?.(edge);
            }}
            onPointerOut={(e) => {
              e.stopPropagation();
              document.body.style.cursor = 'default';
              setLocalHovered(null);
              onHoverEntity?.(null);
            }}
            onClick={(e) => {
              e.stopPropagation();
              const isMulti = e?.nativeEvent?.shiftKey || false;
              onSelectEntity(edge, isMulti);
            }}
          >
            {(isSelected || isHovered) && (
              <Line
                points={[p1, p2]}
                color="#4c7bf4"           // accent blue for selected and hovered edges
                lineWidth={isSelected ? 3 : 2}
                transparent
                opacity={1.0}
                depthTest={false}
              />
            )}
          </group>
        );
      })}

      {/* 3. Interactive 3D Model / Sub-shape Highlight when body is selected */}
      {selectedEntity?.entity_type === 'body' && topology?.bounding_box && (
        (() => {
          const bbox = topology.bounding_box;
          const minPt = bbox.min || [-10, -10, -10];
          const maxPt = bbox.max || [10, 10, 10];
          const center: [number, number, number] = [
            (minPt[0] + maxPt[0]) / 2,
            (minPt[1] + maxPt[1]) / 2,
            (minPt[2] + maxPt[2]) / 2,
          ];
          const size: [number, number, number] = [
            Math.max(0.1, maxPt[0] - minPt[0]),
            Math.max(0.1, maxPt[1] - minPt[1]),
            Math.max(0.1, maxPt[2] - minPt[2]),
          ];
          return (
            <group position={center}>
              <mesh>
                <boxGeometry args={size} />
                <meshBasicMaterial
                  color="#f5a524"
                  wireframe={true}
                  transparent={true}
                  opacity={0.65}
                />
              </mesh>
              <mesh>
                <boxGeometry args={size} />
                <meshBasicMaterial
                  color="#f5a524"
                  transparent={true}
                  opacity={0.06}
                  depthWrite={false}
                />
              </mesh>
            </group>
          );
        })()
      )}
    </group>
  );
}
