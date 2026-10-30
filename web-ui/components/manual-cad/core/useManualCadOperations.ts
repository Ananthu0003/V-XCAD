'use client';

import { useState, useCallback, useRef } from 'react';
import { toast } from 'sonner';
import { CADToolType } from '../ManualCadToolbar';
import { getDefaultParams, getOperationDefinition } from '../features/registry';
import { isOperationApplicable } from '../operations/capabilities';
import { parseApiError } from '../ui-kit';
import type { DetectedFeature } from '../useDetectedFeatures';

export const BODY_TOOLS = new Set<CADToolType>([
  'move', 'rotate', 'scale', 'mirror', 'align', 'primitive', 'shell', 'offset', 'split',
  'linear_pattern', 'polar_pattern', 'heal',
]);

export const FACE_OPTIONAL_BODY_TOOLS = new Set<CADToolType>(['mirror', 'split', 'align', 'shell', 'primitive']);

export interface UseManualCadOperationsOptions {
  sessionId: string;
  activeRevision: string;
  selectedEntity: any | null;
  selectedEntities: any[];
  topology: any | null;
  geometryContext: any;
  detectedFeatures?: DetectedFeature[];
  setActiveRevision: (rev: string) => void;
  setStlUrl: (url: string | null) => void;
  setIsLoading: (loading: boolean) => void;
  clearSelection: () => void;
  fetchHistory: () => Promise<void>;
  refetchFeatures: () => void;
  refetchModelParams: () => void;
  setSelectionMode: (mode: 'body' | 'feature' | 'face' | 'edge') => void;
  createBodyEntity: (topo: any, rev: string) => any;
  setSelectedEntity: (ent: any) => void;
  setSelectedEntities: (ents: any[]) => void;
}

export function useManualCadOperations({
  sessionId,
  activeRevision,
  selectedEntity,
  selectedEntities,
  topology,
  geometryContext,
  detectedFeatures = [],
  setActiveRevision,
  setStlUrl,
  setIsLoading,
  clearSelection,
  fetchHistory,
  refetchFeatures,
  refetchModelParams,
  setSelectionMode,
  createBodyEntity,
  setSelectedEntity,
  setSelectedEntities,
}: UseManualCadOperationsOptions) {
  const [activeTool, setActiveTool] = useState<CADToolType>('select');
  const [params, setParams] = useState<Record<string, any>>({
    radius: 2.0, distance: 1.0, diameter: 6.0, depth: 10.0, width: 20.0, height: 15.0,
  });
  const [paramsByTool, setParamsByTool] = useState<Record<string, Record<string, any>>>({});
  const [previewResult, setPreviewResult] = useState<any | null>(null);
  const [isPreviewActive, setIsPreviewActive] = useState<boolean>(false);
  const previewAbortRef = useRef<AbortController | null>(null);

  // Compute initial params for a tool from defaults and geometryContext
  const computeToolParams = useCallback(
    (tool: CADToolType, ent: any, ctx: any, userEdits?: Record<string, any>) => {
      const def = getOperationDefinition(tool);
      const initial: Record<string, any> = {};
      if (def?.fields) {
        def.fields.forEach((f) => {
          let val = f.default;
          if (typeof f.initial === 'function' && ctx) {
            const initVal = f.initial(ctx, initial);
            if (initVal !== undefined && initVal !== null) {
              val = initVal;
            }
          }
          initial[f.key] = val;
        });
      }
      return { ...initial, ...(userEdits || {}) };
    },
    []
  );

  const handleUpdateParams: React.Dispatch<React.SetStateAction<Record<string, any>>> = useCallback(
    (updater) => {
      setParams((prev) => {
        const next = typeof updater === 'function' ? updater(prev) : updater;
        setParamsByTool((all) => ({
          ...all,
          [activeTool]: next,
        }));
        return next;
      });
    },
    [activeTool]
  );

  const handleSetActiveTool = useCallback(
    (tool: CADToolType) => {
      setActiveTool(tool);
      if (tool !== 'select' && selectedEntity?.entity_type !== 'feature') {
        const toolP = computeToolParams(tool, selectedEntity, geometryContext, paramsByTool[tool]);
        setParams(toolP);
      }
      if (tool === 'fillet' || tool === 'chamfer') {
        setSelectionMode('edge');
      } else if (
        tool === 'hole' ||
        tool === 'pocket' ||
        tool === 'pad' ||
        tool === 'push_pull' ||
        tool === 'round_face_edges'
      ) {
        setSelectionMode('face');
      } else if (BODY_TOOLS.has(tool)) {
        const keepFace =
          FACE_OPTIONAL_BODY_TOOLS.has(tool) &&
          selectedEntity?.entity_type === 'face' &&
          selectedEntity?.surface_type === 'plane';

        if (!keepFace && topology) {
          setSelectionMode('body');
          const b = createBodyEntity(topology, activeRevision);
          setSelectedEntity(b);
          setSelectedEntities([b]);
        }
      }
    },
    [
      selectedEntity,
      geometryContext,
      paramsByTool,
      computeToolParams,
      setSelectionMode,
      topology,
      createBodyEntity,
      activeRevision,
      setSelectedEntity,
      setSelectedEntities,
    ]
  );

  // Build references list for API requests
  const buildRequestReferences = useCallback((): any[] => {
    const targets = selectedEntities.length > 1 ? selectedEntities : selectedEntity ? [selectedEntity] : [];
    const refs: any[] = [];

    targets.forEach((ent) => {
      if (!ent || ent.entity_type === 'body') return;
      if (ent.entity_type === 'feature') {
        const fids = ent.face_ids || [];
        fids.forEach((fid: string) => {
          if (fid && topology?.faces?.[fid]) {
            refs.push(topology.faces[fid]);
          } else if (fid) {
            refs.push({
              ref_id: fid,
              transient_id: fid,
              entity_type: 'face',
              centroid: [0, 0, 0],
            });
          }
        });
      } else {
        refs.push(ent);
      }
    });

    return refs;
  }, [selectedEntities, selectedEntity, topology]);

  // Build parameters dictionary using definition.toRequest
  const buildRequestParameters = useCallback(
    (customParams?: Record<string, any>, opOverride?: string): Record<string, any> => {
      const isFeat = selectedEntity?.entity_type === 'feature';
      const mergedParams =
        customParams &&
        typeof customParams === 'object' &&
        !('nativeEvent' in customParams) &&
        !(customParams instanceof Event)
          ? { ...params, ...customParams }
          : params;
      const opType =
        typeof opOverride === 'string' && opOverride.trim().length > 0
          ? opOverride
          : activeTool !== 'select'
          ? activeTool
          : isFeat
          ? 'edit_feature'
          : activeTool;

      if (isFeat && opType === 'edit_feature') {
        return {
          feature_id: selectedEntity.feature_id,
          face_ids: selectedEntity.face_ids,
          changes: mergedParams.changes || mergedParams,
          ...mergedParams,
        };
      }

      const def = getOperationDefinition(opType as CADToolType);
      let baseReq =
        def && typeof def.toRequest === 'function'
          ? def.toRequest(mergedParams, selectedEntity)
          : { ...getDefaultParams(activeTool), ...mergedParams };

      if (opType === 'delete_feature') {
        const fids =
          mergedParams.face_ids && Array.isArray(mergedParams.face_ids) && mergedParams.face_ids.length > 0
            ? mergedParams.face_ids
            : selectedEntities.length > 1
            ? selectedEntities.map((e) => e.transient_id).filter(Boolean)
            : selectedEntity?.transient_id
            ? [selectedEntity.transient_id]
            : selectedEntity?.face_ids || [];

        baseReq = {
          ...baseReq,
          face_ids: fids,
          feature_id: mergedParams.feature_id || selectedEntity?.feature_id,
          body: mergedParams.body || selectedEntity?.entity_type === 'body',
        };
      }

      return baseReq;
    },
    [params, activeTool, selectedEntity, selectedEntities]
  );

  // Preview Operation
  const handlePreview = useCallback(
    async (overrideOpType?: CADToolType | 'edit_feature', overrideParams?: Record<string, any>) => {
      if (!selectedEntity) {
        toast.error('Please select something to edit first.');
        return;
      }

      if (previewAbortRef.current) {
        previewAbortRef.current.abort();
      }
      const abortController = new AbortController();
      previewAbortRef.current = abortController;

      setIsLoading(true);
      setPreviewResult(null);

      const safeOpType: CADToolType | 'edit_feature' =
        typeof overrideOpType === 'string' && overrideOpType.trim().length > 0
          ? overrideOpType
          : activeTool !== 'select'
          ? activeTool
          : selectedEntity?.entity_type === 'feature'
          ? 'edit_feature'
          : activeTool;

      const safeParams =
        overrideParams &&
        typeof overrideParams === 'object' &&
        !('nativeEvent' in overrideParams) &&
        !(overrideParams instanceof Event)
          ? overrideParams
          : undefined;

      const effectiveParams = buildRequestParameters(safeParams, safeOpType);

      try {
        const res = await fetch('/api/cad/modify/preview', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          signal: abortController.signal,
          body: JSON.stringify({
            session_id: sessionId,
            base_revision: activeRevision,
            operation_type: safeOpType,
            references: buildRequestReferences(),
            parameters: effectiveParams,
          }),
        });

        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.valid) {
          const errorDiag = parseApiError(res, data);
          setPreviewResult({
            validation: data?.validation || { is_valid: false },
            error_diagnostic: {
              code: data?.error_diagnostic?.code || errorDiag.code,
              message: errorDiag.message,
            },
          });
          toast.error(errorDiag.message);
        } else {
          setPreviewResult(data);
          setIsPreviewActive(true);
          if (data.preview_stl_url) {
            setStlUrl(data.preview_stl_url);
          }
          toast.success('Preview generated successfully');
        }
      } catch (err: any) {
        if (err.name === 'AbortError') return;
        const msg = err.message || 'Preview generation failed';
        setPreviewResult({
          validation: { is_valid: false },
          error_diagnostic: { code: 'Network Error', message: msg },
        });
        toast.error(msg);
      } finally {
        setIsLoading(false);
      }
    },
    [
      selectedEntity,
      activeTool,
      buildRequestParameters,
      sessionId,
      activeRevision,
      buildRequestReferences,
      setIsLoading,
      setStlUrl,
    ]
  );

  // Cancel Preview
  const handleCancelPreview = useCallback(() => {
    if (previewAbortRef.current) {
      previewAbortRef.current.abort();
    }
    setIsPreviewActive(false);
    setPreviewResult(null);
    setStlUrl(`/api/cad/modify/file/${sessionId}/revisions/${activeRevision}.stl`);
    toast.info('Preview discarded');
  }, [sessionId, activeRevision, setStlUrl]);

  // Commit Operation
  const handleCommit = useCallback(
    async (overrideOpType?: CADToolType | 'edit_feature', overrideParams?: Record<string, any>) => {
      if (!selectedEntity) return;

      setIsLoading(true);

      const safeOpType: CADToolType | 'edit_feature' =
        typeof overrideOpType === 'string' && overrideOpType.trim().length > 0
          ? overrideOpType
          : activeTool !== 'select'
          ? activeTool
          : selectedEntity?.entity_type === 'feature'
          ? 'edit_feature'
          : activeTool;

      const safeParams =
        overrideParams &&
        typeof overrideParams === 'object' &&
        !('nativeEvent' in overrideParams) &&
        !(overrideParams instanceof Event)
          ? overrideParams
          : undefined;

      const effectiveParams = buildRequestParameters(safeParams, safeOpType);

      try {
        const res = await fetch('/api/cad/modify/commit', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: sessionId,
            base_revision: activeRevision,
            operation_type: safeOpType,
            references: buildRequestReferences(),
            parameters: effectiveParams,
          }),
        });

        const data = await res.json().catch(() => null);
        if (!res.ok || !data?.success) {
          const errorDiag = parseApiError(res, data);
          setPreviewResult({
            error_diagnostic: { code: errorDiag.code, message: errorDiag.message },
          });
          toast.error(errorDiag.message);
          return;
        }

        setActiveRevision(data.new_revision);
        setStlUrl(data.stl_url);
        setIsPreviewActive(false);
        setPreviewResult(null);
        clearSelection();
        setActiveTool('select');
        toast.success(`Committed revision ${data.new_revision}`);
        await fetchHistory();
        refetchFeatures();
        refetchModelParams();
      } catch (err: any) {
        toast.error(err.message || 'Failed to commit revision');
      } finally {
        setIsLoading(false);
      }
    },
    [
      selectedEntity,
      setIsLoading,
      activeTool,
      buildRequestParameters,
      sessionId,
      activeRevision,
      buildRequestReferences,
      setActiveRevision,
      setStlUrl,
      clearSelection,
      fetchHistory,
      refetchFeatures,
      refetchModelParams,
    ]
  );

  // Delete Operation and Recompute
  const handleDeleteOperation = useCallback(
    async (opId: string) => {
      setIsLoading(true);
      try {
        const res = await fetch('/api/cad/modify/recompute', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            session_id: sessionId,
            target_op_id: opId,
          }),
        });

        const data = await res.json().catch(() => null);
        if (res.ok && data?.success) {
          setActiveRevision(data.final_revision);
          setStlUrl(data.stl_url);
          toast.success(`Operation removed: recomputed to ${data.final_revision}`);
          await fetchHistory();
          refetchFeatures();
          refetchModelParams();
        } else {
          throw new Error(parseApiError(res, data).message);
        }
      } catch (err: any) {
        toast.error(err.message || 'Failed to delete operation');
      } finally {
        setIsLoading(false);
      }
    },
    [sessionId, setIsLoading, setActiveRevision, setStlUrl, fetchHistory, refetchFeatures, refetchModelParams]
  );

  return {
    activeTool,
    setActiveTool,
    params,
    setParams,
    paramsByTool,
    previewResult,
    setPreviewResult,
    isPreviewActive,
    setIsPreviewActive,
    previewAbortRef,
    computeToolParams,
    handleUpdateParams,
    handleSetActiveTool,
    buildRequestReferences,
    buildRequestParameters,
    handlePreview,
    handleCancelPreview,
    handleCommit,
    handleDeleteOperation,
  };
}

