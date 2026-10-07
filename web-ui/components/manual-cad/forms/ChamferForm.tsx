import React from 'react';
import { NumInput, presetBtnStyle } from '../shared';

export function ChamferForm({ params, onChange }: { params: Record<string, any>; onChange: (k: string, v: any) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <NumInput label="Distance" paramKey="distance" step={0.25} min={0.1} defaultVal={1} unit="mm" params={params} onChange={onChange} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11, fontFamily: 'var(--font-sans)', color: 'var(--mcad-text-muted)' }}>Quick:</span>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {[0.5, 1, 1.5, 2, 3].map(d => (
            <button
              key={d}
              type="button"
              onClick={() => onChange('distance', d)}
              style={{
                ...presetBtnStyle,
                background: params.distance === d ? 'var(--mcad-teal-tint)' : 'var(--mcad-input)',
                color: params.distance === d ? 'var(--mcad-teal)' : 'var(--mcad-text-muted)',
                border: `1px solid ${params.distance === d ? 'var(--mcad-teal)' : 'var(--mcad-border-ctrl)'}`,
              }}
            >
              {d}mm
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
