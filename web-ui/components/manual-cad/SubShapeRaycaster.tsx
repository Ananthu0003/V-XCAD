'use client';

import React, { useState, useMemo } from 'react';
import * as THREE from 'three';
import { Line } from '@react-three/drei';

export interface SubShapeRaycasterProps {
  topology: any | null;
  selectedEntity: any | null;
  onSelectEntity: (entity: any, multiSelect?: boolean) => void;
  hoveredEntity?: any | null;
  onHoverEntity?: (entity: any | null) => void;
  selectionMode?: 'body' | 'feature' | 'face' | 'edge' | 'all';
  highlightedFaceIds?: string[] | null;
  onHighlightFaces?: (faceIds: string[] | null) => void;
  detectedFeatures?: any[];
  selectedEntities?: any[];
  geometryScale?: number;
}

/**
 * Calculates squared distance from a 3D point to a 3D triangle.
 * Based on Christer Ericson's Real-Time Collision Detection.
 */
function distSqPointTriangle(
  p: [number, number, number],
  a: [number, number, number],
  b: [number, number, number],
  c: [number, number, number]
): number {
  const abX = b[0] - a[0], abY = b[1] - a[1], abZ = b[2] - a[2];
  const acX = c[0] - a[0], acY = c[1] - a[1], acZ = c[2] - a[2];
  const apX = p[0] - a[0], apY = p[1] - a[1], apZ = p[2] - a[2];

  const d1 = abX * apX + abY * apY + abZ * apZ;
  const d2 = acX * apX + acY * apY + acZ * apZ;
  if (d1 <= 0 && d2 <= 0) return apX * apX + apY * apY + apZ * apZ;

  const bpX = p[0] - b[0], bpY = p[1] - b[1], bpZ = p[2] - b[2];
  const d3 = abX * bpX + abY * bpY + abZ * bpZ;
  const d4 = acX * bpX + acY * bpY + acZ * bpZ;
  if (d3 >= 0 && d4 <= d3) return bpX * bpX + bpY * bpY + bpZ * bpZ;

  const vc = d1 * d4 - d3 * d2;
  if (vc <= 0 && d1 >= 0 && d3 <= 0) {
    const v = d1 / (d1 - d3);
    const ex = apX - v * abX, ey = apY - v * abY, ez = apZ - v * abZ;
    return ex * ex + ey * ey + ez * ez;
  }

  const cpX = p[0] - c[0], cpY = p[1] - c[1], cpZ = p[2] - c[2];
  const d5 = abX * cpX + abY * cpY + abZ * cpZ;
  const d6 = acX * cpX + acY * cpY + acZ * cpZ;
  if (d6 >= 0 && d5 <= d6) return cpX * cpX + cpY * cpY + cpZ * cpZ;

  const vb = d5 * d2 - d1 * d6;
  if (vb <= 0 && d2 >= 0 && d6 <= 0) {
    const w = d2 / (d2 - d6);
    const ex = apX - w * acX, ey = apY - w * acY, ez = apZ - w * acZ;
    return ex * ex + ey * ey + ez * ez;
  }

  const va = d3 * d6 - d5 * d4;
  if (va <= 0 && (d4 - d3) >= 0 && (d5 - d6) >= 0) {
    const w = (d4 - d3) / ((d4 - d3) + (d5 - d6));
    const bcX = c[0] - b[0], bcY = c[1] - b[1], bcZ = c[2] - b[2];
    const ex = bpX - w * bcX, ey = bpY - w * bcY, ez = bpZ - w * bcZ;
    return ex * ex + ey * ey + ez * ez;
  }

  const denom = 1.0 / (va + vb + vc);
  const v = vb * denom;
  const w = vc * denom;
  const ex = apX - abX * v - acX * w;
  const ey = apY - abY * v - acY * w;
  const ez = apZ - abZ * v - acZ * w;
  return ex * ex + ey * ey + ez * ez;
}

/**
 * Resolves which face was clicked based on intersection point and normal.
 * Uses exact triangle intersection first, then robust analytical surface distance.
 */
export function findFaceFromHit(
  point: [number, number, number],
  normal: [number, number, number] | undefined,
  faces: Record<string, any>
): any | null {
  if (!faces || Object.keys(faces).length === 0) return null;
  const [px, py, pz] = point;

  let bestTriFace: any = null;
  let bestTriDistSq = Infinity;

  // Stage 1: Exact Point-to-Triangle Distance across all face triangulations
  for (const face of Object.values(faces)) {
    if (face.triangles && face.triangles.length >= 9) {
      if (normal && face.normal) {
        const dotN = face.normal[0] * normal[0] + face.normal[1] * normal[1] + face.normal[2] * normal[2];
        if (dotN < -0.1) continue; // Face points in opposite direction
      }

      const bbox = face.bounding_box;
      if (bbox?.min && bbox?.max) {
        const tol = 3.0;
        if (
          px < bbox.min[0] - tol || px > bbox.max[0] + tol ||
          py < bbox.min[1] - tol || py > bbox.max[1] + tol ||
          pz < bbox.min[2] - tol || pz > bbox.max[2] + tol
        ) {
          continue;
        }
      }

      const tris = face.triangles;
      for (let i = 0; i < tris.length; i += 9) {
        const a: [number, number, number] = [tris[i], tris[i + 1], tris[i + 2]];
        const b: [number, number, number] = [tris[i + 3], tris[i + 4], tris[i + 5]];
        const c: [number, number, number] = [tris[i + 6], tris[i + 7], tris[i + 8]];

        const dSq = distSqPointTriangle(point, a, b, c);
        if (dSq < bestTriDistSq) {
          bestTriDistSq = dSq;
          bestTriFace = face;
        }
      }
    }
  }

  // If we found a triangle within reasonable distance (e.g. 2mm = 4.0 distSq), return it!
  if (bestTriFace && bestTriDistSq <= 4.0) {
    return bestTriFace;
  }

  // Stage 2: Analytical Surface Distance Fallback
  let bestFace: any = null;
  let bestScore = Infinity;

  for (const face of Object.values(faces)) {
    const bbox = face.bounding_box;
    if (bbox?.min && bbox?.max) {
      const tol = 3.0;
      if (
        px < bbox.min[0] - tol || px > bbox.max[0] + tol ||
        py < bbox.min[1] - tol || py > bbox.max[1] + tol ||
        pz < bbox.min[2] - tol || pz > bbox.max[2] + tol
      ) {
        continue;
      }
    }

    let dist = Infinity;
    if (face.surface_type === 'plane' && face.normal) {
      const [fnx, fny, fnz] = face.normal;
      if (normal) {
        const dotN = fnx * normal[0] + fny * normal[1] + fnz * normal[2];
        if (dotN < 0.2) continue;
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
    } else if (face.surface_type === 'cone' && face.axis && face.radius) {
      const [ax, ay, az] = face.axis;
      const [cx, cy, cz] = face.centroid || [0, 0, 0];
      const vx = px - cx, vy = py - cy, vz = pz - cz;
      const proj = vx * ax + vy * ay + vz * az;
      const perpX = vx - proj * ax, perpY = vy - proj * ay, perpZ = vz - proj * az;
      const radDist = Math.sqrt(perpX * perpX + perpY * perpY + perpZ * perpZ);
      dist = Math.abs(radDist - face.radius);
    } else {
      const [cx, cy, cz] = face.centroid || [0, 0, 0];
      dist = Math.hypot(px - cx, py - cy, pz - cz);
    }

    const [cx, cy, cz] = face.centroid || [0, 0, 0];
    const centroidDist = Math.hypot(px - cx, py - cy, pz - cz);
    const score = dist * 100 + centroidDist * 0.001;

    if (score < bestScore) {
      bestScore = score;
      bestFace = face;
    }
  }

  return bestFace || bestTriFace;
}

function FaceSurfaceMesh({
  face,
  isSelected,
  isHovered,
  onPointerOver,
  onPointerOut,
  onClick,
  onDoubleClick,
}: {
  face: any;
  isSelected: boolean;
  isHovered: boolean;
  onPointerOver: (e: any) => void;
  onPointerOut: (e: any) => void;
  onClick: (e: any) => void;
  onDoubleClick?: (e: any) => void;
}) {
  const { geometry, boundaryGeometry } = useMemo(() => {
    // 1. Exact B-Rep triangulation if available
    if (face.triangles && face.triangles.length >= 9) {
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(new Float32Array(face.triangles), 3));
      geom.computeVertexNormals();

      // Extract true perimeter and hole boundary contours
      const edgeCounts = new Map<string, [number, number, number, number, number, number]>();
      const tri = face.triangles;
      for (let i = 0; i < tri.length; i += 9) {
        const p1 = [tri[i], tri[i + 1], tri[i + 2]];
        const p2 = [tri[i + 3], tri[i + 4], tri[i + 5]];
        const p3 = [tri[i + 6], tri[i + 7], tri[i + 8]];

        const addEdge = (a: number[], b: number[]) => {
          const ka = `${a[0].toFixed(3)},${a[1].toFixed(3)},${a[2].toFixed(3)}`;
          const kb = `${b[0].toFixed(3)},${b[1].toFixed(3)},${b[2].toFixed(3)}`;
          const key = ka < kb ? `${ka}_${kb}` : `${kb}_${ka}`;
          if (edgeCounts.has(key)) {
            edgeCounts.delete(key);
          } else {
            edgeCounts.set(key, [a[0], a[1], a[2], b[0], b[1], b[2]]);
          }
        };

        addEdge(p1, p2);
        addEdge(p2, p3);
        addEdge(p3, p1);
      }

      let bGeom: THREE.BufferGeometry | null = null;
      if (edgeCounts.size > 0) {
        const linePositions = new Float32Array(edgeCounts.size * 6);
        let idx = 0;
        for (const edge of edgeCounts.values()) {
          linePositions[idx++] = edge[0];
          linePositions[idx++] = edge[1];
          linePositions[idx++] = edge[2];
          linePositions[idx++] = edge[3];
          linePositions[idx++] = edge[4];
          linePositions[idx++] = edge[5];
        }
        bGeom = new THREE.BufferGeometry();
        bGeom.setAttribute('position', new THREE.BufferAttribute(linePositions, 3));
      }

      return { geometry: geom, boundaryGeometry: bGeom };
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
        if (vVal > vMax) vMax = vVal;
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

      const bPositions = new Float32Array([
        p1.x, p1.y, p1.z,  p2.x, p2.y, p2.z,
        p2.x, p2.y, p2.z,  p3.x, p3.y, p3.z,
        p3.x, p3.y, p3.z,  p4.x, p4.y, p4.z,
        p4.x, p4.y, p4.z,  p1.x, p1.y, p1.z,
      ]);
      const bGeom = new THREE.BufferGeometry();
      bGeom.setAttribute('position', new THREE.BufferAttribute(bPositions, 3));

      return { geometry: geom, boundaryGeometry: bGeom };
    }

    return { geometry: null, boundaryGeometry: null };
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
        onDoubleClick={(e) => {
          e.stopPropagation();
          onDoubleClick?.(e);
        }}
      >
        <meshStandardMaterial
          // FreeCAD-style electric cyan/blue: Solid, bright, and vibrant
          color={isSelected ? '#00d2ff' : isHovered ? '#38bdf8' : '#ffffff'}
          emissive={isSelected ? '#0077b6' : isHovered ? '#0284c7' : '#000000'}
          emissiveIntensity={isSelected ? 0.65 : isHovered ? 0.35 : 0.0}
          transparent={true}
          opacity={isSelected ? 0.88 : isHovered ? 0.45 : 0.0001}
          depthTest={true}
          depthWrite={false}
          side={THREE.DoubleSide}
          polygonOffset={true}
          polygonOffsetFactor={isSelected ? -4 : isHovered ? -2 : 0}
          polygonOffsetUnits={isSelected ? -4 : isHovered ? -2 : 0}
          roughness={0.15}
          metalness={0.1}
        />
      </mesh>

      {/* Crisp boundary line segments following real contours, holes, and corners */}
      {isSelected && boundaryGeometry && (
        <lineSegments geometry={boundaryGeometry}>
          <lineBasicMaterial color="#005588" linewidth={2.5} depthTest={true} />
        </lineSegments>
      )}
      {isHovered && !isSelected && boundaryGeometry && (
        <lineSegments geometry={boundaryGeometry}>
          <lineBasicMaterial color="#38bdf8" linewidth={1.5} depthTest={true} />
        </lineSegments>
      )}
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
  onHighlightFaces,
  detectedFeatures,
  selectedEntities,
  geometryScale = 1.0,
}: SubShapeRaycasterProps) {
  const [localHovered, setLocalHovered] = useState<string | null>(null);

  const activeHover = hoveredEntity?.transient_id || localHovered;

  const faces = useMemo(() => Object.values(topology?.faces || {}) as any[], [topology?.faces]);
  const edges = useMemo(() => Object.values(topology?.edges || {}) as any[], [topology?.edges]);

  const isBodySelected =
    selectedEntity?.entity_type === 'body' ||
    selectedEntities?.some((ent: any) => ent?.entity_type === 'body');
  const isBodyHovered = hoveredEntity?.entity_type === 'body';

  const showFaces = selectionMode === 'face' || selectionMode === 'all' || selectionMode === 'body' || selectionMode === 'feature';
  const showEdges = selectionMode === 'edge' || selectionMode === 'all';

  const hlFaceSet = useMemo(() => new Set(highlightedFaceIds || []), [highlightedFaceIds]);
  const selectedFaceSet = useMemo(() => {
    const s = new Set<string>();
    if (isBodySelected && topology?.faces) {
      Object.keys(topology.faces).forEach((fid) => s.add(fid));
    }
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
  }, [selectedEntity, selectedEntities, isBodySelected, topology?.faces]);

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

  if (!topology) return null;

  return (
    <group name="sub-shape-raycaster" scale={geometryScale}>
      {/* 1. Interactive 3D Face Meshes */}
      {showFaces && faces.map((face) => {
        const isSelected = selectedFaceSet.has(face.transient_id);
        const isHovered = isBodyHovered || activeHover === face.transient_id || hlFaceSet.has(face.transient_id);

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
              if (selectionMode === 'feature' && detectedFeatures) {
                const feat = detectedFeatures.find((df: any) => df.face_ids?.includes(face.transient_id));
                if (feat) {
                  onHoverEntity?.({ entity_type: 'feature', ...feat });
                  onHighlightFaces?.(feat.face_ids);
                  return;
                }
              }
              onHoverEntity?.(face);
            }}
            onPointerOut={() => {
              setLocalHovered(null);
              onHoverEntity?.(null);
              if (selectionMode === 'feature') {
                onHighlightFaces?.(null);
              }
            }}
            onClick={(e) => {
              if (selectionMode === 'body') {
                e?.stopPropagation?.();
                onSelectEntity({ entity_type: 'body' });
                return;
              }
              const isMulti = e?.nativeEvent?.shiftKey || false;
              if (selectionMode === 'feature' && detectedFeatures) {
                const feat = detectedFeatures.find((df: any) => df.face_ids?.includes(face.transient_id));
                if (feat) {
                  e?.stopPropagation?.();
                  onSelectEntity({ entity_type: 'feature', ...feat }, isMulti);
                  return;
                }
              }
              onSelectEntity(face, isMulti);
            }}
            onDoubleClick={(e) => {
              e?.stopPropagation?.();
              if (detectedFeatures && detectedFeatures.length > 0) {
                const feat = detectedFeatures.find((df: any) => df.face_ids?.includes(face.transient_id));
                if (feat) {
                  onSelectEntity({ entity_type: 'feature', ...feat });
                  return;
                }
              }
              onSelectEntity({ entity_type: 'body' });
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
        const edgePoints = (edge.points && Array.isArray(edge.points) && edge.points.length >= 2)
          ? (edge.points as [number, number, number][])
          : [p1, p2];

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
            {/* Fat invisible pick line so Three.js raycasting intercepts hover/clicks reliably */}
            <Line
              points={edgePoints}
              color="#ffffff"
              lineWidth={12}
              transparent
              opacity={0.0001}
              depthTest={false}
            />
            {/* Visual highlighted edge curve */}
            {(isSelected || isHovered) && (
              <Line
                points={edgePoints}
                color="#4c7bf4"
                lineWidth={isSelected ? 3.5 : 2}
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
