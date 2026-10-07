import React from 'react';
import { NumInput, presetBtnStyle } from '../shared';

export function FilletForm({ params, onChange }: { params: Record<string, any>; onChange: (k: string, v: any) => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <NumInput label="Radius" paramKey="radius" step={0.25} min={0.1} defaultVal={2} unit="mm" params={params} onChange={onChange} />
      <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{ fontSize: 11, fontFamily: 'var(--font-sans)', color: 'var(--mcad-text-muted)' }}>Quick:</span>
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
          {[1, 2, 3, 5, 8].map(r => (
            <button
              key={r}
              type="button"
              onClick={() => onChange('radius', r)}
              style={{
                ...presetBtnStyle,
                background: params.radius === r ? 'var(--mcad-teal-tint)' : 'var(--mcad-input)',
                color: params.radius === r ? 'var(--mcad-teal)' : 'var(--mcad-text-muted)',
                border: `1px solid ${params.radius === r ? 'var(--mcad-teal)' : 'var(--mcad-border-ctrl)'}`,
              }}
            >
              R{r}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
