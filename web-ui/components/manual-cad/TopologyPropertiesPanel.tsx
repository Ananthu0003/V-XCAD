'use client';

import React from 'react';
import { 
  Eye, 
  Check, 
  X, 
  AlertTriangle, 
  Info, 
  Loader2, 
  Activity,
  Layers,
  Sparkles
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { CADToolType } from './ManualCadToolbar';
import { cn } from '@/lib/utils';

interface TopologyPropertiesPanelProps {
  selectedEntity: any | null;
  activeTool: CADToolType;
  params: Record<string, any>;
  setParams: React.Dispatch<React.SetStateAction<Record<string, any>>>;
  onPreview: () => void;
  onCancelPreview: () => void;
  onCommit: () => void;
  isPreviewActive: boolean;
  isLoading: boolean;
  validationReport: any | null;
  errorDiagnostic: any | null;
}

export function TopologyPropertiesPanel({
  selectedEntity,
  activeTool,
  params,
  setParams,
  onPreview,
  onCancelPreview,
  onCommit,
  isPreviewActive,
  isLoading,
  validationReport,
  errorDiagnostic
}: TopologyPropertiesPanelProps) {

  const handleParamChange = (key: string, val: any) => {
    setParams(prev => ({ ...prev, [key]: val }));
  };

  return (
    <div className="flex flex-col h-full bg-transparent p-4 space-y-5 overflow-y-auto text-sm">
      {/* 1. Selected Geometry Details */}
      <div className="space-y-2.5">
        <div className="flex items-center justify-between">
          <span className="text-[11px] font-mono uppercase tracking-wider text-muted-foreground font-semibold">
            Selected Topology
          </span>
          {selectedEntity && (
            <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-primary/10 text-primary font-bold">
              {selectedEntity.transient_id}
            </span>
          )}
        </div>

        {selectedEntity ? (
          <div className="p-3 bg-muted/40 rounded-xl border border-border/60 space-y-2 text-xs font-mono">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Type:</span>
              <span className="font-semibold capitalize">{selectedEntity.entity_type} ({selectedEntity.surface_type || selectedEntity.curve_type || 'analytical'})</span>
            </div>
            {selectedEntity.area && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Area:</span>
                <span>{selectedEntity.area.toFixed(1)} mm²</span>
              </div>
            )}
            {selectedEntity.length && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Length:</span>
                <span>{selectedEntity.length.toFixed(1)} mm</span>
              </div>
            )}
            {selectedEntity.radius && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Radius:</span>
                <span>R{selectedEntity.radius.toFixed(2)} mm</span>
              </div>
            )}
            {selectedEntity.normal && (
              <div className="flex justify-between">
                <span className="text-muted-foreground">Normal:</span>
                <span>[{selectedEntity.normal.map((n: number) => n.toFixed(1)).join(', ')}]</span>
              </div>
            )}
            <div className="flex justify-between">
              <span className="text-muted-foreground">Centroid:</span>
              <span>[{selectedEntity.centroid.map((c: number) => c.toFixed(1)).join(', ')}]</span>
            </div>
          </div>
        ) : (
          <div className="p-4 rounded-xl border border-dashed border-border/60 text-center text-xs text-muted-foreground">
            Click any face or edge in the 3D viewport to inspect and modify.
          </div>
        )}
      </div>

      {/* 2. Active Operation Parameters */}
      {activeTool !== 'select' && activeTool !== 'measure' && (
        <div className="space-y-4 pt-2 border-t border-border/60">
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-mono uppercase tracking-wider text-primary font-bold">
              Operation: {activeTool.toUpperCase()}
            </span>
          </div>

          {/* FILLET */}
          {activeTool === 'fillet' && (
            <div className="space-y-3">
              <div className="flex justify-between text-xs">
                <Label>Fillet Radius</Label>
                <span className="font-mono text-primary font-bold">{(params.radius || 2.0).toFixed(1)} mm</span>
              </div>
              <div className="flex gap-1.5">
                {[1.0, 2.0, 3.0, 5.0, 8.0].map((r) => (
                  <button
                    key={r}
                    type="button"
                    onClick={() => handleParamChange('radius', r)}
                    className={cn(
                      'px-2 py-0.5 text-[10px] font-mono rounded border transition-colors cursor-pointer',
                      params.radius === r
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-muted/60 hover:bg-muted text-muted-foreground border-border/80'
                    )}
                  >
                    R{r}
                  </button>
                ))}
              </div>
              <input
                type="range"
                min="0.25"
                max="15.0"
                step="0.25"
                value={params.radius || 2.0}
                onChange={(e) => handleParamChange('radius', parseFloat(e.target.value))}
                className="w-full accent-primary cursor-pointer"
              />
              <Input
                type="number"
                step="0.1"
                min="0.1"
                value={params.radius || 2.0}
                onChange={(e) => handleParamChange('radius', parseFloat(e.target.value) || 0.5)}
                className="h-8 font-mono text-xs"
              />
            </div>
          )}

          {/* CHAMFER */}
          {activeTool === 'chamfer' && (
            <div className="space-y-3">
              <div className="flex justify-between text-xs">
                <Label>Chamfer Distance</Label>
                <span className="font-mono text-primary font-bold">{(params.distance || 1.0).toFixed(1)} mm</span>
              </div>
              <div className="flex gap-1.5">
                {[0.5, 1.0, 1.5, 2.0, 3.0].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => handleParamChange('distance', d)}
                    className={cn(
                      'px-2 py-0.5 text-[10px] font-mono rounded border transition-colors cursor-pointer',
                      params.distance === d
                        ? 'bg-primary text-primary-foreground border-primary'
                        : 'bg-muted/60 hover:bg-muted text-muted-foreground border-border/80'
                    )}
                  >
                    {d}mm
                  </button>
                ))}
              </div>
              <input
                type="range"
                min="0.25"
                max="10.0"
                step="0.25"
                value={params.distance || 1.0}
                onChange={(e) => handleParamChange('distance', parseFloat(e.target.value))}
                className="w-full accent-primary cursor-pointer"
              />
              <Input
                type="number"
                step="0.1"
                min="0.1"
                value={params.distance || 1.0}
                onChange={(e) => handleParamChange('distance', parseFloat(e.target.value) || 0.5)}
                className="h-8 font-mono text-xs"
              />
            </div>
          )}

          {/* HOLE WIZARD */}
          {activeTool === 'hole' && (
            <div className="space-y-3.5 text-xs">
              {/* Hole Type */}
              <div className="space-y-1.5">
                <Label className="text-[11px] text-muted-foreground">Hole Type</Label>
                <div className="grid grid-cols-2 gap-1.5">
                  {(['blind', 'through', 'counterbore', 'countersink'] as const).map((ht) => (
                    <button
                      key={ht}
                      type="button"
                      onClick={() => handleParamChange('hole_type', ht)}
                      className={cn(
                        'py-1 px-2 text-[11px] font-medium rounded-md border capitalize text-center transition-colors cursor-pointer',
                        (params.hole_type || 'blind') === ht
                          ? 'bg-primary text-primary-foreground border-primary font-bold shadow-sm'
                          : 'bg-muted/40 hover:bg-muted text-foreground border-border/80'
                      )}
                    >
                      {ht}
                    </button>
                  ))}
                </div>
              </div>

              {/* Standard Tap/Clearance Presets */}
              <div className="space-y-1.5">
                <Label className="text-[11px] text-muted-foreground">Standard Clearance Preset</Label>
                <div className="flex flex-wrap gap-1">
                  {[
                    { label: 'M3', dia: 3.4, cbDia: 6.0, cbDepth: 3.5 },
                    { label: 'M4', dia: 4.5, cbDia: 8.0, cbDepth: 4.5 },
                    { label: 'M5', dia: 5.5, cbDia: 10.0, cbDepth: 5.5 },
                    { label: 'M6', dia: 6.6, cbDia: 11.5, cbDepth: 6.5 },
                    { label: 'M8', dia: 9.0, cbDia: 15.0, cbDepth: 8.5 },
                    { label: '1/4"', dia: 6.7, cbDia: 11.0, cbDepth: 6.5 },
                  ].map((p) => (
                    <button
                      key={p.label}
                      type="button"
                      onClick={() => {
                        handleParamChange('diameter', p.dia);
                        handleParamChange('cbore_diameter', p.cbDia);
                        handleParamChange('cbore_depth', p.cbDepth);
                        handleParamChange('csink_diameter', p.cbDia);
                      }}
                      className="px-2 py-0.5 text-[10px] font-mono rounded bg-muted hover:bg-muted/80 text-foreground border border-border/80 cursor-pointer"
                    >
                      {p.label} (⌀{p.dia})
                    </button>
                  ))}
                </div>
              </div>

              {/* Diameter & Depth */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[11px]">Diameter (⌀ mm)</Label>
                  <Input
                    type="number"
                    step="0.1"
                    min="0.1"
                    value={params.diameter || 6.0}
                    onChange={(e) => handleParamChange('diameter', parseFloat(e.target.value) || 1.0)}
                    className="h-8 font-mono text-xs"
                  />
                </div>
                {params.hole_type !== 'through' && (
                  <div className="space-y-1">
                    <Label className="text-[11px]">Depth (mm)</Label>
                    <Input
                      type="number"
                      step="0.5"
                      min="0.5"
                      value={params.depth || 10.0}
                      onChange={(e) => handleParamChange('depth', parseFloat(e.target.value) || 1.0)}
                      className="h-8 font-mono text-xs"
                    />
                  </div>
                )}
              </div>

              {/* Counterbore Parameters */}
              {params.hole_type === 'counterbore' && (
                <div className="grid grid-cols-2 gap-2 p-2 rounded-lg bg-muted/30 border border-border/60">
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">C-Bore Dia (mm)</Label>
                    <Input
                      type="number"
                      step="0.5"
                      value={params.cbore_diameter || (params.diameter || 6.0) * 1.8}
                      onChange={(e) => handleParamChange('cbore_diameter', parseFloat(e.target.value) || 1.0)}
                      className="h-7 font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">C-Bore Depth (mm)</Label>
                    <Input
                      type="number"
                      step="0.5"
                      value={params.cbore_depth || 4.0}
                      onChange={(e) => handleParamChange('cbore_depth', parseFloat(e.target.value) || 1.0)}
                      className="h-7 font-mono text-xs"
                    />
                  </div>
                </div>
              )}

              {/* Countersink Parameters */}
              {params.hole_type === 'countersink' && (
                <div className="grid grid-cols-2 gap-2 p-2 rounded-lg bg-muted/30 border border-border/60">
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">C-Sink Dia (mm)</Label>
                    <Input
                      type="number"
                      step="0.5"
                      value={params.csink_diameter || (params.diameter || 6.0) * 1.8}
                      onChange={(e) => handleParamChange('csink_diameter', parseFloat(e.target.value) || 1.0)}
                      className="h-7 font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[10px] text-muted-foreground">Angle (°)</Label>
                    <Input
                      type="number"
                      step="1"
                      value={params.csink_angle || 90.0}
                      onChange={(e) => handleParamChange('csink_angle', parseFloat(e.target.value) || 90.0)}
                      className="h-7 font-mono text-xs"
                    />
                  </div>
                </div>
              )}

              {/* 2D Position Offsets */}
              <div className="space-y-1.5 pt-1">
                <Label className="text-[11px] text-muted-foreground">Face Offset Position (X / Y mm)</Label>
                <div className="grid grid-cols-2 gap-2">
                  <Input
                    type="number"
                    step="1.0"
                    placeholder="X offset"
                    value={params.pos_x ?? 0.0}
                    onChange={(e) => handleParamChange('pos_x', parseFloat(e.target.value) || 0.0)}
                    className="h-7 font-mono text-xs"
                  />
                  <Input
                    type="number"
                    step="1.0"
                    placeholder="Y offset"
                    value={params.pos_y ?? 0.0}
                    onChange={(e) => handleParamChange('pos_y', parseFloat(e.target.value) || 0.0)}
                    className="h-7 font-mono text-xs"
                  />
                </div>
              </div>
            </div>
          )}

          {/* POCKET */}
          {activeTool === 'pocket' && (
            <div className="space-y-3.5 text-xs">
              {/* Profile Shape */}
              <div className="space-y-1.5">
                <Label className="text-[11px] text-muted-foreground">Pocket Shape</Label>
                <div className="grid grid-cols-3 gap-1">
                  {(['rectangle', 'circle', 'slot'] as const).map((ps) => (
                    <button
                      key={ps}
                      type="button"
                      onClick={() => handleParamChange('profile', ps)}
                      className={cn(
                        'py-1 px-1.5 text-[11px] font-medium rounded-md border capitalize text-center transition-colors cursor-pointer',
                        (params.profile || 'rectangle') === ps
                          ? 'bg-primary text-primary-foreground border-primary font-bold shadow-sm'
                          : 'bg-muted/40 hover:bg-muted text-foreground border-border/80'
                      )}
                    >
                      {ps}
                    </button>
                  ))}
                </div>
              </div>

              {/* Dimensions */}
              {(params.profile || 'rectangle') === 'rectangle' && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[11px]">Width (X mm)</Label>
                    <Input
                      type="number"
                      step="1.0"
                      value={params.width || 25.0}
                      onChange={(e) => handleParamChange('width', parseFloat(e.target.value) || 1.0)}
                      className="h-8 font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Height (Y mm)</Label>
                    <Input
                      type="number"
                      step="1.0"
                      value={params.height || 18.0}
                      onChange={(e) => handleParamChange('height', parseFloat(e.target.value) || 1.0)}
                      className="h-8 font-mono text-xs"
                    />
                  </div>
                </div>
              )}

              {params.profile === 'circle' && (
                <div className="space-y-1">
                  <Label className="text-[11px]">Pocket Diameter (⌀ mm)</Label>
                  <Input
                    type="number"
                    step="1.0"
                    value={params.diameter || params.width || 25.0}
                    onChange={(e) => handleParamChange('diameter', parseFloat(e.target.value) || 1.0)}
                    className="h-8 font-mono text-xs"
                  />
                </div>
              )}

              {params.profile === 'slot' && (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[11px]">Slot Length (mm)</Label>
                    <Input
                      type="number"
                      step="1.0"
                      value={params.length || 35.0}
                      onChange={(e) => handleParamChange('length', parseFloat(e.target.value) || 1.0)}
                      className="h-8 font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Slot Width (mm)</Label>
                    <Input
                      type="number"
                      step="1.0"
                      value={params.width || 12.0}
                      onChange={(e) => handleParamChange('width', parseFloat(e.target.value) || 1.0)}
                      className="h-8 font-mono text-xs"
                    />
                  </div>
                </div>
              )}

              {/* Depth & Corner Radius */}
              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[11px]">Depth (mm)</Label>
                  <Input
                    type="number"
                    step="0.5"
                    value={params.depth || 6.0}
                    onChange={(e) => handleParamChange('depth', parseFloat(e.target.value) || 1.0)}
                    className="h-8 font-mono text-xs"
                  />
                </div>
                {(params.profile || 'rectangle') === 'rectangle' && (
                  <div className="space-y-1">
                    <Label className="text-[11px]">Corner Fillet (R mm)</Label>
                    <Input
                      type="number"
                      step="0.5"
                      min="0.0"
                      value={params.corner_radius ?? 2.0}
                      onChange={(e) => handleParamChange('corner_radius', parseFloat(e.target.value) || 0.0)}
                      className="h-8 font-mono text-xs"
                    />
                  </div>
                )}
              </div>

              {/* Position and Rotation */}
              <div className="grid grid-cols-3 gap-1.5 pt-1">
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Pos X</Label>
                  <Input
                    type="number"
                    step="1.0"
                    value={params.pos_x ?? 0.0}
                    onChange={(e) => handleParamChange('pos_x', parseFloat(e.target.value) || 0.0)}
                    className="h-7 font-mono text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Pos Y</Label>
                  <Input
                    type="number"
                    step="1.0"
                    value={params.pos_y ?? 0.0}
                    onChange={(e) => handleParamChange('pos_y', parseFloat(e.target.value) || 0.0)}
                    className="h-7 font-mono text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Rot (°)</Label>
                  <Input
                    type="number"
                    step="15"
                    value={params.rotation_deg ?? 0.0}
                    onChange={(e) => handleParamChange('rotation_deg', parseFloat(e.target.value) || 0.0)}
                    className="h-7 font-mono text-xs"
                  />
                </div>
              </div>
            </div>
          )}

          {/* PAD (BOSS EXTRUSION) */}
          {activeTool === 'pad' && (
            <div className="space-y-3.5 text-xs">
              {/* Profile Shape */}
              <div className="space-y-1.5">
                <Label className="text-[11px] text-muted-foreground">Pad Shape</Label>
                <div className="grid grid-cols-2 gap-1.5">
                  {(['rectangle', 'circle'] as const).map((ps) => (
                    <button
                      key={ps}
                      type="button"
                      onClick={() => handleParamChange('profile', ps)}
                      className={cn(
                        'py-1 px-2 text-[11px] font-medium rounded-md border capitalize text-center transition-colors cursor-pointer',
                        (params.profile || 'rectangle') === ps
                          ? 'bg-primary text-primary-foreground border-primary font-bold shadow-sm'
                          : 'bg-muted/40 hover:bg-muted text-foreground border-border/80'
                      )}
                    >
                      {ps}
                    </button>
                  ))}
                </div>
              </div>

              {(params.profile || 'rectangle') === 'rectangle' ? (
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-[11px]">Width (X mm)</Label>
                    <Input
                      type="number"
                      step="1.0"
                      value={params.width || 20.0}
                      onChange={(e) => handleParamChange('width', parseFloat(e.target.value) || 1.0)}
                      className="h-8 font-mono text-xs"
                    />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-[11px]">Length (Y mm)</Label>
                    <Input
                      type="number"
                      step="1.0"
                      value={params.length || 20.0}
                      onChange={(e) => handleParamChange('length', parseFloat(e.target.value) || 1.0)}
                      className="h-8 font-mono text-xs"
                    />
                  </div>
                </div>
              ) : (
                <div className="space-y-1">
                  <Label className="text-[11px]">Diameter (⌀ mm)</Label>
                  <Input
                    type="number"
                    step="1.0"
                    value={params.diameter || params.width || 20.0}
                    onChange={(e) => handleParamChange('diameter', parseFloat(e.target.value) || 1.0)}
                    className="h-8 font-mono text-xs"
                  />
                </div>
              )}

              <div className="grid grid-cols-2 gap-2">
                <div className="space-y-1">
                  <Label className="text-[11px]">Boss Height (mm)</Label>
                  <Input
                    type="number"
                    step="0.5"
                    value={params.height || 6.0}
                    onChange={(e) => handleParamChange('height', parseFloat(e.target.value) || 1.0)}
                    className="h-8 font-mono text-xs"
                  />
                </div>
                {(params.profile || 'rectangle') === 'rectangle' && (
                  <div className="space-y-1">
                    <Label className="text-[11px]">Corner Fillet (R mm)</Label>
                    <Input
                      type="number"
                      step="0.5"
                      min="0.0"
                      value={params.corner_radius ?? 1.5}
                      onChange={(e) => handleParamChange('corner_radius', parseFloat(e.target.value) || 0.0)}
                      className="h-8 font-mono text-xs"
                    />
                  </div>
                )}
              </div>

              {/* Position and Rotation */}
              <div className="grid grid-cols-3 gap-1.5 pt-1">
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Pos X</Label>
                  <Input
                    type="number"
                    step="1.0"
                    value={params.pos_x ?? 0.0}
                    onChange={(e) => handleParamChange('pos_x', parseFloat(e.target.value) || 0.0)}
                    className="h-7 font-mono text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Pos Y</Label>
                  <Input
                    type="number"
                    step="1.0"
                    value={params.pos_y ?? 0.0}
                    onChange={(e) => handleParamChange('pos_y', parseFloat(e.target.value) || 0.0)}
                    className="h-7 font-mono text-xs"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-[10px] text-muted-foreground">Rot (°)</Label>
                  <Input
                    type="number"
                    step="15"
                    value={params.rotation_deg ?? 0.0}
                    onChange={(e) => handleParamChange('rotation_deg', parseFloat(e.target.value) || 0.0)}
                    className="h-7 font-mono text-xs"
                  />
                </div>
              </div>
            </div>
          )}

          {/* Diagnostics / Error Output */}
          {errorDiagnostic && (
            <div className="p-3 rounded-xl bg-destructive/10 border border-destructive/30 space-y-1.5 text-xs text-destructive">
              <div className="flex items-center gap-1.5 font-bold">
                <AlertTriangle className="size-4 shrink-0" />
                <span>{errorDiagnostic.code || 'Operation Error'}</span>
              </div>
              <p className="font-mono text-[11px] leading-relaxed">{errorDiagnostic.message}</p>
            </div>
          )}

          {validationReport?.is_valid && (
            <div className="p-2.5 rounded-lg bg-primary/10 border border-primary/20 text-xs font-mono text-primary flex items-center gap-2">
              <Activity className="size-4 shrink-0" />
              <span>B-Rep Valid (Volume: {validationReport.volume_mm3?.toFixed(1)} mm³)</span>
            </div>
          )}

          {/* Action Buttons: Preview vs. Commit */}
          <div className="space-y-2 pt-2">
            {!isPreviewActive ? (
              <Button
                onClick={onPreview}
                disabled={isLoading || !selectedEntity}
                variant="outline"
                className="w-full gap-2 border-primary/40 text-primary hover:bg-primary/10 cursor-pointer"
              >
                {isLoading ? <Loader2 className="size-4 animate-spin" /> : <Eye className="size-4" />}
                <span>Generate Preview</span>
              </Button>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                <Button
                  onClick={onCancelPreview}
                  disabled={isLoading}
                  variant="outline"
                  className="gap-1.5 border-destructive/40 text-destructive hover:bg-destructive/10 cursor-pointer"
                >
                  <X className="size-4" />
                  <span>Cancel</span>
                </Button>
                <Button
                  onClick={onCommit}
                  disabled={isLoading}
                  className="gap-1.5 bg-primary text-primary-foreground hover:bg-primary/90 cursor-pointer"
                >
                  {isLoading ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
                  <span>Apply / Commit</span>
                </Button>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
