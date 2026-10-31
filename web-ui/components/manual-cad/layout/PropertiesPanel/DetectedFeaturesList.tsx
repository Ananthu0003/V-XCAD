'use client';

import React, { useState, useMemo } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Search,
  RotateCw,
  CircleDot,
  Package,
  Square,
  RectangleHorizontal,
  CornerDownRight,
  Scissors,
  Box,
} from 'lucide-react';
import type { DetectedFeature } from '../../useDetectedFeatures';

interface DetectedFeaturesListProps {
  detectedFeatures?: DetectedFeature[];
  isLoadingFeatures?: boolean;
  selectedEntityId?: string | null;
  onSelectTopologyEntity?: (entity: any, multiSelect?: boolean) => void;
  onRefetchFeatures?: () => void;
  onHighlightFaces?: (faceIds: string[] | null) => void;
}

function getFeatureIcon(kind: string) {
  switch (kind) {
    case 'hole':
      return CircleDot;
    case 'boss':
      return Package;
    case 'pocket':
      return Square;
    case 'slot':
      return RectangleHorizontal;
    case 'fillet':
      return CornerDownRight;
    case 'chamfer':
      return Scissors;
    default:
      return Box;
  }
}

export function DetectedFeaturesList({
  detectedFeatures = [],
  isLoadingFeatures = false,
  selectedEntityId,
  onSelectTopologyEntity,
  onRefetchFeatures,
  onHighlightFaces,
}: DetectedFeaturesListProps) {
  const [featureSearch, setFeatureSearch] = useState('');
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({
    hole: true,
    boss: true,
    pocket: true,
    slot: true,
    fillet: true,
    chamfer: true,
  });

  const featureGroups = useMemo(() => {
    const groups: Record<string, DetectedFeature[]> = {
      hole: [],
      boss: [],
      pocket: [],
      slot: [],
      fillet: [],
      chamfer: [],
    };
    (detectedFeatures || []).forEach((df) => {
      if (!df) return;
      const featName = df.name || (df as any).part_name || (df as any).feature_id || 'Feature';
      const featKind = (df.kind || (df as any).feature_type || 'other').toLowerCase();
      if (featureSearch) {
        const q = featureSearch.toLowerCase();
        if (!featName.toLowerCase().includes(q) && !featKind.includes(q)) {
          return;
        }
      }
      if (!groups[featKind]) {
        groups[featKind] = [];
      }
      groups[featKind].push(df);
    });
    return groups;
  }, [detectedFeatures, featureSearch]);

  return (
    <div className="mcad-section">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
        <div className="mcad-section-title" style={{ margin: 0 }}>
          Detected Features
        </div>
        {onRefetchFeatures && (
          <button
            type="button"
            onClick={onRefetchFeatures}
            disabled={isLoadingFeatures}
            title="Re-scan model for parametric features"
            style={{
              background: 'transparent',
              border: 'none',
              color: 'var(--mcad-text-muted)',
              cursor: 'pointer',
              padding: 2,
            }}
          >
            <RotateCw size={12} className={isLoadingFeatures ? 'animate-spin' : ''} />
          </button>
        )}
      </div>

      {detectedFeatures.length > 12 && (
        <div style={{ position: 'relative', marginBottom: 8 }}>
          <Search
            size={12}
            style={{
              position: 'absolute',
              left: 8,
              top: '50%',
              transform: 'translateY(-50%)',
              color: 'var(--mcad-text-muted)',
            }}
          />
          <input
            type="text"
            placeholder="Search features…"
            value={featureSearch}
            onChange={(ev) => setFeatureSearch(ev.target.value)}
            style={{
              width: '100%',
              height: 26,
              paddingLeft: 24,
              paddingRight: 8,
              background: 'var(--mcad-input)',
              border: '1px solid var(--mcad-border-ctrl)',
              borderRadius: 6,
              fontSize: 11,
              color: 'var(--mcad-text-primary)',
              outline: 'none',
            }}
          />
        </div>
      )}

      {isLoadingFeatures && detectedFeatures.length === 0 ? (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {[1, 2, 3].map((i) => (
            <div
              key={i}
              style={{
                height: 28,
                borderRadius: 6,
                background: 'var(--mcad-input)',
                opacity: 0.5,
              }}
            />
          ))}
        </div>
      ) : detectedFeatures.length === 0 ? (
        <div style={{ fontSize: 11, color: 'var(--mcad-text-muted)', textAlign: 'center', padding: '12px 0' }}>
          No features detected on this revision.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
          {Object.entries(featureGroups).map(([kind, list]) => {
            if (list.length === 0) return null;
            const isOpen = openGroups[kind] ?? true;
            const KindIcon = getFeatureIcon(kind);

            return (
              <div key={kind} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <button
                  type="button"
                  onClick={() =>
                    setOpenGroups((prev) => ({
                      ...prev,
                      [kind]: !isOpen,
                    }))
                  }
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '3px 4px',
                    background: 'transparent',
                    border: 'none',
                    color: 'var(--mcad-text-secondary)',
                    fontSize: 11,
                    fontWeight: 600,
                    textTransform: 'capitalize',
                    cursor: 'pointer',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <KindIcon size={12} style={{ color: 'var(--mcad-text-muted)' }} />
                    <span>
                      {kind}s ({list.length})
                    </span>
                  </div>
                  {isOpen ? <ChevronDown size={11} /> : <ChevronRight size={11} />}
                </button>

                {isOpen && (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 2, paddingLeft: 6 }}>
                    {list.map((df) => {
                      const isSelected = selectedEntityId === df.feature_id;

                      return (
                        <button
                          key={df.feature_id}
                          type="button"
                          onClick={() =>
                            onSelectTopologyEntity?.({
                              entity_type: 'feature',
                              ...df,
                            })
                          }
                          onMouseEnter={() => onHighlightFaces?.(df.face_ids)}
                          onMouseLeave={() => onHighlightFaces?.(null)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            padding: '5px 8px',
                            borderRadius: 6,
                            background: isSelected ? 'var(--mcad-accent-tint)' : 'transparent',
                            border: `1px solid ${isSelected ? 'var(--mcad-accent-line)' : 'transparent'}`,
                            color: isSelected ? 'var(--mcad-accent)' : 'var(--mcad-text-primary)',
                            fontSize: 11,
                            textAlign: 'left',
                            cursor: 'pointer',
                            transition: 'background 0.1s',
                          }}
                        >
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, overflow: 'hidden' }}>
                            <div
                              style={{
                                width: 4,
                                height: 4,
                                borderRadius: '50%',
                                background: df.editable ? 'var(--mcad-accent)' : 'var(--mcad-text-muted)',
                                flexShrink: 0,
                              }}
                            />
                            <span style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                              {df.name || (df as any).part_name || (df as any).feature_id || 'Feature'}
                            </span>
                          </div>

                          <span
                            style={{
                              fontSize: 10,
                              color: 'var(--mcad-text-muted)',
                              textTransform: 'lowercase',
                              flexShrink: 0,
                            }}
                          >
                            {df.subtype}
                          </span>
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

