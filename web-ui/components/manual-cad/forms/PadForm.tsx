import React from 'react';
import { SectionLabel, SegControl, NumInput, PositionRow } from '../shared';

export function PadForm({ params, onChange }: { params: Record<string, any>; onChange: (k: string, v: any) => void }) {
  const profile = params.profile || 'rectangle';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div>
        <SectionLabel>Shape</SectionLabel>
        <SegControl
          options={[
            { value: 'rectangle', label: 'Rect' },
            { value: 'circle', label: 'Circle' },
          ]}
          value={profile}
          onChange={v => onChange('profile', v)}
        />
      </div>

      {profile === 'rectangle' && (
        <>
          <NumInput label="Width" paramKey="width" step={1} min={0.1} defaultVal={20} unit="mm" params={params} onChange={onChange} />
          <NumInput label="Length" paramKey="length" step={1} min={0.1} defaultVal={20} unit="mm" params={params} onChange={onChange} />
          <NumInput label="Height" paramKey="height" step={0.5} min={0.1} defaultVal={6} unit="mm" params={params} onChange={onChange} />
          <NumInput label="Corner R" paramKey="corner_radius" step={0.5} min={0} defaultVal={1.5} unit="mm" params={params} onChange={onChange} />
        </>
      )}

      {profile === 'circle' && (
        <>
          <NumInput label="Diameter (⌀)" paramKey="diameter" step={1} min={0.1} defaultVal={20} unit="mm" params={params} onChange={onChange} />
          <NumInput label="Height" paramKey="height" step={0.5} min={0.1} defaultVal={6} unit="mm" params={params} onChange={onChange} />
        </>
      )}

      <PositionRow params={params} onChange={onChange} />
      <NumInput label="Rotation" paramKey="rotation_deg" step={15} min={0} defaultVal={0} unit="°" params={params} onChange={onChange} />
    </div>
  );
}
