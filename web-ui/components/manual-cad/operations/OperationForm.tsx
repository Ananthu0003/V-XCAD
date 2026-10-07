import React, { useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import {
  SectionLabel,
  SegControl,
  NumInput,
  PositionRow,
  presetBtnStyle,
} from '../shared';
import type { OperationDefinition, OperationField } from './registry';
import type { TopologyEntity } from './capabilities';

export interface OperationFormProps {
  definition: OperationDefinition;
  values: Record<string, unknown>;
  onChange: (key: string, val: unknown) => void;
  entity?: TopologyEntity | null;
}

export function OperationForm({
  definition,
  values,
  onChange,
  entity,
}: OperationFormProps) {
  const [moreExpanded, setMoreExpanded] = useState(false);

  // Escape hatch for custom forms
  if (definition.customForm) {
    const Custom = definition.customForm;
    return <Custom params={values} onChange={onChange} entity={entity} />;
  }

  // Filter visible fields
  const isFieldVisible = (f: OperationField) => {
    if (f.visibleWhen) {
      return f.visibleWhen(values, entity);
    }
    return true;
  };

  const basicFields = definition.fields.filter(
    (f) => !f.advanced && isFieldVisible(f)
  );
  const advancedFields = definition.fields.filter(
    (f) => f.advanced && isFieldVisible(f)
  );

  const renderField = (field: OperationField) => {
    switch (field.type) {
      case 'segment': {
        const currentVal = (values[field.key] ?? field.default) as string;
        return (
          <div key={field.key}>
            <SectionLabel>{field.label}</SectionLabel>
            <SegControl
              options={field.options || []}
              value={currentVal}
              onChange={(val) => onChange(field.key, val)}
            />
          </div>
        );
      }

      case 'number': {
        return (
          <div key={field.key} style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <NumInput
              label={field.label}
              paramKey={field.key}
              step={field.step}
              min={field.min}
              defaultVal={field.default as number}
              unit={field.unit}
              params={values}
              onChange={onChange}
            />
            {field.quickPresets && field.quickPresets.length > 0 && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: -2 }}>
                <span
                  style={{
                    fontSize: 11,
                    fontFamily: 'var(--font-sans)',
                    color: 'var(--mcad-text-muted)',
                  }}
                >
                  Quick:
                </span>
                <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                  {field.quickPresets.map((qp) => {
                    const isSelected = (values[field.key] ?? field.default) === qp;
                    const pillText =
                      field.key === 'radius'
                        ? `R${qp}`
                        : field.unit
                        ? `${qp}${field.unit}`
                        : `${qp}`;
                    return (
                      <button
                        key={qp}
                        type="button"
                        onClick={() => onChange(field.key, qp)}
                        style={{
                          ...presetBtnStyle,
                          background: isSelected
                            ? 'var(--mcad-teal-tint)'
                            : 'var(--mcad-input)',
                          color: isSelected
                            ? 'var(--mcad-teal)'
                            : 'var(--mcad-text-muted)',
                          border: `1px solid ${
                            isSelected
                              ? 'var(--mcad-teal)'
                              : 'var(--mcad-border-ctrl)'
                          }`,
                        }}
                      >
                        {pillText}
                      </button>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        );
      }

      case 'select': {
        return (
          <div
            key={field.key}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              minHeight: 28,
            }}
          >
            <span
              style={{
                fontSize: 12,
                fontFamily: 'var(--font-sans)',
                color: 'var(--mcad-text-secondary)',
              }}
            >
              {field.label}
            </span>
            <select
              value={(values[field.key] ?? '') as string}
              onChange={(e) => {
                const optVal = e.target.value;
                onChange(field.key, optVal);
                const matched = field.options?.find((o) => o.value === optVal);
                if (matched?.meta) {
                  const m = matched.meta as { dia?: number; cbDia?: number; cbDepth?: number };
                  if (m.dia !== undefined) onChange('diameter', m.dia);
                  if (values.hole_type === 'counterbore') {
                    if (m.cbDia !== undefined) onChange('cbore_diameter', m.cbDia);
                    if (m.cbDepth !== undefined) onChange('cbore_depth', m.cbDepth);
                  }
                  if (values.hole_type === 'countersink') {
                    if (m.cbDia !== undefined) onChange('csink_diameter', m.cbDia);
                  }
                }
              }}
              style={{
                width: 140,
                height: 28,
                background: 'var(--mcad-input)',
                border: '1px solid var(--mcad-border-ctrl)',
                borderRadius: 8,
                color: 'var(--mcad-text-primary)',
                fontFamily: 'var(--font-sans)',
                fontSize: 11,
                paddingLeft: 8,
                outline: 'none',
                cursor: 'pointer',
              }}
            >
              <option value="" disabled>
                {field.placeholder || 'Select…'}
              </option>
              {field.options?.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
        );
      }

      case 'position': {
        return <PositionRow key={field.key} params={values} onChange={onChange} />;
      }

      case 'toggle': {
        const checked = !!(values[field.key] ?? field.default);
        return (
          <label
            key={field.key}
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              minHeight: 28,
              cursor: 'pointer',
            }}
          >
            <span
              style={{
                fontSize: 12,
                fontFamily: 'var(--font-sans)',
                color: 'var(--mcad-text-secondary)',
              }}
            >
              {field.label}
            </span>
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => onChange(field.key, e.target.checked)}
              style={{ accentColor: 'var(--mcad-teal)', cursor: 'pointer' }}
            />
          </label>
        );
      }

      default:
        return null;
    }
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
      {/* Basic fields (max 3-4 fields) */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {basicFields.map(renderField)}
      </div>

      {/* Advanced / More options group */}
      {advancedFields.length > 0 && (
        <div style={{ marginTop: 2 }}>
          <button
            type="button"
            onClick={() => setMoreExpanded((prev) => !prev)}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 4,
              fontSize: 11,
              fontFamily: 'var(--font-sans)',
              color: 'var(--mcad-text-muted)',
              background: 'transparent',
              border: 'none',
              cursor: 'pointer',
              padding: '4px 0',
              fontWeight: 500,
            }}
          >
            {moreExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
            More options
          </button>
          {moreExpanded && (
            <div
              style={{
                display: 'flex',
                flexDirection: 'column',
                gap: 8,
                marginTop: 6,
                paddingLeft: 4,
                borderLeft: '1px solid var(--mcad-border)',
              }}
            >
              {advancedFields.map(renderField)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
