import React from 'react';
import { SectionLabel, SegControl, NumInput, PositionRow } from '../shared';

export function HoleForm({ params, onChange }: { params: Record<string, any>; onChange: (k: string, v: any) => void }) {
  const holeType = params.hole_type || 'blind';
  const presets = [
    { label: 'M3', dia: 3.4, cbDia: 6.0, cbDepth: 3.5 },
    { label: 'M4', dia: 4.5, cbDia: 8.0, cbDepth: 4.5 },
    { label: 'M5', dia: 5.5, cbDia: 10.0, cbDepth: 5.5 },
    { label: 'M6', dia: 6.6, cbDia: 11.5, cbDepth: 6.5 },
    { label: 'M8', dia: 9.0, cbDia: 15.0, cbDepth: 8.5 },
    { label: '1/4"', dia: 6.7, cbDia: 11.0, cbDepth: 6.5 },
  ];

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div>
        <SectionLabel>Hole Type</SectionLabel>
        <SegControl
          options={[
            { value: 'blind', label: 'Blind' },
            { value: 'through', label: 'Through' },
            { value: 'counterbore', label: 'Counterbore' },
            { value: 'countersink', label: 'Countersink' },
          ]}
          value={holeType}
          onChange={v => onChange('hole_type', v)}
        />
      </div>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', minHeight: 28 }}>
        <span style={{ fontSize: 12, fontFamily: 'var(--font-sans)', color: 'var(--mcad-text-secondary)' }}>Preset</span>
        <select
          onChange={e => {
            const p = presets.find(x => x.label === e.target.value);
            if (p) {
              onChange('diameter', p.dia);
              if (holeType === 'counterbore') {
                onChange('cbore_diameter', p.cbDia);
                onChange('cbore_depth', p.cbDepth);
              }
              if (holeType === 'countersink') {
                onChange('csink_diameter', p.cbDia);
              }
            }
          }}
          defaultValue=""
          style={{
            width: 140, height: 28,
            background: 'var(--mcad-input)', border: '1px solid var(--mcad-border-ctrl)',
            borderRadius: 8, color: 'var(--mcad-text-primary)',
            fontFamily: 'var(--font-sans)', fontSize: 11,
            paddingLeft: 8, outline: 'none', cursor: 'pointer',
          }}
        >
          <option value="" disabled>Standard preset…</option>
          {presets.map(p => (
            <option key={p.label} value={p.label}>{p.label} (⌀{p.dia} mm)</option>
          ))}
        </select>
      </div>

      <NumInput label="Diameter (⌀)" paramKey="diameter" step={0.1} min={0.1} defaultVal={6} unit="mm" params={params} onChange={onChange} />

      {holeType !== 'through' && (
        <NumInput label="Depth" paramKey="depth" step={0.5} min={0.5} defaultVal={10} unit="mm" params={params} onChange={onChange} />
      )}

      {holeType === 'counterbore' && (
        <>
          <NumInput label="C-Bore ⌀" paramKey="cbore_diameter" step={0.5} min={0.1} defaultVal={11} unit="mm" params={params} onChange={onChange} />
          <NumInput label="C-Bore Depth" paramKey="cbore_depth" step={0.5} min={0.1} defaultVal={4} unit="mm" params={params} onChange={onChange} />
        </>
      )}

      {holeType === 'countersink' && (
        <>
          <NumInput label="C-Sink ⌀" paramKey="csink_diameter" step={0.5} min={0.1} defaultVal={11} unit="mm" params={params} onChange={onChange} />
          <NumInput label="Angle" paramKey="csink_angle" step={1} min={30} defaultVal={90} unit="°" params={params} onChange={onChange} />
        </>
      )}

      <PositionRow params={params} onChange={onChange} />
    </div>
  );
}
