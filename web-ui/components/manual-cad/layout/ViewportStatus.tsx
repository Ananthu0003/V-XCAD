'use client';

import React from 'react';
import { Loader2 } from 'lucide-react';

export interface ViewportStatusProps {
  selectedEntity: any | null;
  isLoading: boolean;
  hasModel?: boolean;
}

export function ViewportStatus({
  selectedEntity,
  isLoading,
  hasModel = true,
}: ViewportStatusProps) {
  let text = 'Nothing selected: click a face or 3D model, or press V';

  if (!hasModel) {
    text = 'No CAD model loaded';
  } else if (isLoading) {
    text = 'Computing geometry…';
  } else if (selectedEntity) {
    const e = selectedEntity;
    const parts: string[] = [];
    parts.push(e.transient_id);

    if (e.entity_type === 'body') {
      parts.push('3D Solid Model');
      if (e.volume_mm3 != null) parts.push(`${e.volume_mm3.toFixed(1)} mm³`);
      const bbox = e.bounding_box;
      if (bbox?.min && bbox?.max) {
        parts.push(
          `${(bbox.max[0] - bbox.min[0]).toFixed(1)}×${(bbox.max[1] - bbox.min[1]).toFixed(1)}×${(
            bbox.max[2] - bbox.min[2]
          ).toFixed(1)} mm`
        );
      }
    } else {
      if (e.surface_type) parts.push(e.surface_type);
      if (e.curve_type) parts.push(e.curve_type);
      if (e.area != null) parts.push(`${e.area.toFixed(1)} mm²`);
      if (e.length != null) parts.push(`${e.length.toFixed(1)} mm`);
      if (e.normal) {
        const n = e.normal as number[];
        const labels = ['+X', '-X', '+Y', '-Y', '+Z', '-Z'];
        const axes = [
          [1, 0, 0],
          [-1, 0, 0],
          [0, 1, 0],
          [0, -1, 0],
          [0, 0, 1],
          [0, 0, -1],
        ];
        let best = 0;
        let bestDot = -2;
        axes.forEach(([ax, ay, az], i) => {
          const dot = ax * n[0] + ay * n[1] + az * n[2];
          if (dot > bestDot) {
            bestDot = dot;
            best = i;
          }
        });
        if (bestDot > 0.9) parts.push(`normal ${labels[best]}`);
      }
    }
    text = parts.join(' · ');
  }

  return (
    <div
      style={{
        position: 'absolute',
        bottom: 12,
        left: 12,
        zIndex: 15,
        fontSize: 11,
        fontFamily: 'var(--font-mono)',
        color: 'var(--mcad-text-muted)',
        pointerEvents: 'none',
        userSelect: 'none',
        maxWidth: 420,
        whiteSpace: 'nowrap',
        overflow: 'hidden',
        textOverflow: 'ellipsis',
      }}
    >
      {isLoading && (
        <Loader2
          size={11}
          className="inline mr-1 animate-spin"
          style={{ color: 'var(--mcad-teal)', verticalAlign: 'middle' }}
        />
      )}
      {text}
    </div>
  );
}

