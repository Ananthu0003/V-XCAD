import React from 'react';
import { SectionLabel, SegControl, NumInput, PositionRow } from '../shared';

export function PocketForm({ params, onChange }: { params: Record<string, any>; onChange: (k: string, v: any) => void }) {
  const profile = params.profile || 'rectangle';
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div>
        <SectionLabel>Shape</SectionLabel>
        <SegControl
          options={[
            { value: 'rectangle', label: 'Rect' },
            { value: 'circle', label: 'Circle' },
            { value: 'slot', label: 'Slot' },
          ]}
          value={profile}
          onChange={v => onChange('profile', v)}
        />
      </div>

      {profile === 'rectangle' && (
        <>
          <NumInput label="Width" paramKey="width" step={1} min={0.1} defaultVal={25} unit="mm" params={params} onChange={onChange} />
          <NumInput label="Length" paramKey="height" step={1} min={0.1} defaultVal={18} unit="mm" params={params} onChange={onChange} />
          <NumInput label="Depth" paramKey="depth" step={0.5} min={0.1} defaultVal={6} unit="mm" params={params} onChange={onChange} />
          <NumInput label="Corner R" paramKey="corner_radius" step={0.5} min={0} defaultVal={2} unit="mm" params={params} onChange={onChange} />
        </>
      )}

      {profile === 'circle' && (
        <>
          <NumInput label="Diameter (⌀)" paramKey="diameter" step={1} min={0.1} defaultVal={25} unit="mm" params={params} onChange={onChange} />
          <NumInput label="Depth" paramKey="depth" step={0.5} min={0.1} defaultVal={6} unit="mm" params={params} onChange={onChange} />
        </>
      )}

      {profile === 'slot' && (
        <>
          <NumInput label="Length" paramKey="length" step={1} min={0.1} defaultVal={35} unit="mm" params={params} onChange={onChange} />
          <NumInput label="Width" paramKey="width" step={1} min={0.1} defaultVal={12} unit="mm" params={params} onChange={onChange} />
          <NumInput label="Depth" paramKey="depth" step={0.5} min={0.1} defaultVal={6} unit="mm" params={params} onChange={onChange} />
        </>
      )}

      <PositionRow params={params} onChange={onChange} />
      <NumInput label="Rotation" paramKey="rotation_deg" step={15} min={0} defaultVal={0} unit="°" params={params} onChange={onChange} />
    </div>
  );
}
