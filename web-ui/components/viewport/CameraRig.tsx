'use client';

import { useEffect, useRef } from 'react';
import { useThree } from '@react-three/fiber';
import * as THREE from 'three';

type CameraControlsLike = {
  setLookAt: (
    positionX: number, positionY: number, positionZ: number,
    targetX: number, targetY: number, targetZ: number,
    enableTransition?: boolean
  ) => void;
};

interface CameraRigAnnotation {
  p1?: [number, number, number];
  p2?: [number, number, number];
  center?: [number, number, number];
  axis?: [number, number, number];
  value?: number;
  radius?: number;
  type?: string;
}

interface CameraRigProps {
  activeParameter: string | null;
  activeFeatureId?: string | null;
  annotations: Record<string, CameraRigAnnotation>;
  geometryInfo: {
    center: [number, number, number];
    scale: number;
    size?: [number, number, number];
    bounding_box?: { min: [number, number, number]; max: [number, number, number] };
  } | null;
  modelToSetupTransform?: number[][] | number[];
}

export function CameraRig({ activeParameter, activeFeatureId, annotations, geometryInfo, modelToSetupTransform }: CameraRigProps) {
  const camera = useThree((state) => state.camera) as THREE.PerspectiveCamera;
  const controls = useThree((state) => state.controls) as CameraControlsLike | null;
  const viewportSize = useThree((state) => state.size);
  const aspect = viewportSize.width / viewportSize.height;

  // Only react when the inputs that actually matter changed (the annotations
  // object identity changes on every re-render, which we must ignore).
  const lastSignature = useRef<string | null>(null);

  const setupMatrix = (() => {
    if (!modelToSetupTransform) return null;
    const flat = Array.isArray(modelToSetupTransform[0])
      ? (modelToSetupTransform as number[][]).flat()
      : (modelToSetupTransform as number[]);
    return new THREE.Matrix4().fromArray(flat).transpose();
  })();

  useEffect(() => {
    if (!controls || typeof controls.setLookAt !== 'function') return;

    // Feature framing is handled by ViewportController — never act on feature ids.
    if (activeFeatureId) return;

    // A selected parameter without a derived annotation (e.g. eps or an
    // unmatched dimension) falls through to the model-fit branch below so the
    // camera still responds to the selection.
    const hasAnnotation = !!(activeParameter && annotations && annotations[activeParameter]);

    const signature = JSON.stringify([activeParameter, hasAnnotation, annotations, geometryInfo]);
    if (signature === lastSignature.current) return;
    lastSignature.current = signature;

    const scale = geometryInfo?.scale ?? 1.0;
    const center = geometryInfo?.center ?? [0, 0, 0];

    // The STL mesh is rendered at raw (scaled) model coordinates — it is never
    // re-centered — so annotation points map 1:1 via `pt * scale`.
    const lookAtDest = new THREE.Vector3(center[0], center[1], center[2]);
    const camPosDest = new THREE.Vector3(5, 5, 5);

    if (hasAnnotation) {
      const annotation = annotations[activeParameter];
      const type = annotation.type || (annotation.p1 && annotation.p2 ? 'height' : (annotation.center ? 'diameter' : 'height'));

      const p1 = new THREE.Vector3();
      const p2 = new THREE.Vector3();
      const featureCenter = new THREE.Vector3();

      if (type === 'diameter' || type === 'chamfer') {
        const c = annotation.center || [0, 0, 0];
        featureCenter.set(c[0] * scale, c[1] * scale, c[2] * scale);
        const val = type === 'diameter'
          ? (annotation.value || (annotation.radius ? annotation.radius * 2 : 10.0))
          : (annotation.radius || 10.0);
        const r = (val / 2) * scale;
        p1.copy(featureCenter).add(new THREE.Vector3(-r, 0, 0));
        p2.copy(featureCenter).add(new THREE.Vector3(r, 0, 0));
      } else {
        const rawP1 = annotation.p1 || [0, 0, 0];
        const rawP2 = annotation.p2 || [0, 0, 0];
        p1.set(rawP1[0] * scale, rawP1[1] * scale, rawP1[2] * scale);
        p2.set(rawP2[0] * scale, rawP2[1] * scale, rawP2[2] * scale);
        featureCenter.addVectors(p1, p2).multiplyScalar(0.5);
      }

      // Bring the CAD-space target into the (possibly rotated) setup space so
      // the camera follows the part as the user sees it.
      if (setupMatrix) {
        featureCenter.applyMatrix4(setupMatrix);
      }

      lookAtDest.copy(featureCenter);

      const distance = p1.distanceTo(p2);
      let zoomOffset = Math.max(distance * 2.5, 3); // Dynamic scaling window padding

      // Handle narrow viewports/aspect ratios when parameter is highlighted
      if (aspect < 1) {
        zoomOffset = zoomOffset / aspect;
      }

      camPosDest.set(
        featureCenter.x + zoomOffset * 0.7,
        featureCenter.y + zoomOffset * 0.7,
        featureCenter.z + zoomOffset * 1.0
      );
    } else {
      // Fallback: Reset to centering the whole model geometry if no parameter is selected
      const size = geometryInfo?.bounding_box
        ? [
            geometryInfo.bounding_box.max[0] - geometryInfo.bounding_box.min[0],
            geometryInfo.bounding_box.max[1] - geometryInfo.bounding_box.min[1],
            geometryInfo.bounding_box.max[2] - geometryInfo.bounding_box.min[2],
          ]
        : geometryInfo?.size;

      if (size) {
        const maxDim = Math.max(size[0], size[1], size[2]);

        // Fit distance calculation
        const radius = maxDim / 2;
        const fovRad = (camera.fov * Math.PI) / 180;
        let dist = radius / Math.sin(fovRad / 2);

        // Adjust for narrow aspect ratio (e.g. portrait screen or side panels open)
        if (aspect < 1) {
          dist = dist / aspect;
        }

        // Dynamic camera distance with safety padding multiplier
        const fitDistance = Math.max(dist * 1.35, 10);

        lookAtDest.set(center[0], center[1], center[2]);
        camPosDest.set(
          center[0] + fitDistance * 0.7,
          center[1] + fitDistance * 0.7,
          center[2] + fitDistance * 1.0
        );
      } else {
        camPosDest.set(5, 5, 5);
      }
    }

    // CameraControls derives the camera position from its internal spherical
    // state on every update(), so we must drive the transition through the
    // controls API instead of lerping camera.position manually.
    controls.setLookAt(
      camPosDest.x, camPosDest.y, camPosDest.z,
      lookAtDest.x, lookAtDest.y, lookAtDest.z,
      true
    );
  }, [activeParameter, activeFeatureId, annotations, geometryInfo, controls, camera, aspect, setupMatrix]);

  return null;
}
