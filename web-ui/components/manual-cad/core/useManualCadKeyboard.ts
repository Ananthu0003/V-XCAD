'use client';

import { useEffect } from 'react';
import type { CADToolType } from '../ManualCadToolbar';
import type { DetectedFeature } from '../useDetectedFeatures';

export interface UseManualCadKeyboardOptions {
  contextMenu: any;
  setContextMenu: (menu: any) => void;
  activeTool: CADToolType;
  setActiveTool: (tool: CADToolType) => void;
  isPreviewActive: boolean;
  handleCancelPreview: () => void;
  selectedEntity: any | null;
  selectedEntities: any[];
  detectedFeatures?: DetectedFeature[];
  handleCommit: (overrideOpType?: CADToolType | 'edit_feature', overrideParams?: Record<string, any>) => void;
  canUndo: boolean;
  canRedo: boolean;
  handleUndo: () => void;
  handleRedo: () => void;
}

export function useManualCadKeyboard({
  contextMenu,
  setContextMenu,
  activeTool,
  setActiveTool,
  isPreviewActive,
  handleCancelPreview,
  selectedEntity,
  selectedEntities,
  detectedFeatures = [],
  handleCommit,
  canUndo,
  canRedo,
  handleUndo,
  handleRedo,
}: UseManualCadKeyboardOptions) {
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA')) {
        return;
      }

      if (e.key === 'Escape') {
        if (contextMenu) {
          setContextMenu(null);
          return;
        }

        if (activeTool !== 'select') {
          if (isPreviewActive) {
            handleCancelPreview();
          }
          setActiveTool('select');
        }
        return;
      }

      // Delete key shortcut for deleting selected face, feature, or body
      if (e.key === 'Delete' || e.key === 'Del' || (e.key === 'Backspace' && !e.ctrlKey && !e.metaKey)) {
        if (
          selectedEntity &&
          (selectedEntity.entity_type === 'face' ||
            selectedEntity.entity_type === 'feature' ||
            selectedEntity.entity_type === 'body')
        ) {
          e.preventDefault();
          if (selectedEntity.entity_type === 'feature') {
            handleCommit('delete_feature', {
              feature_id: selectedEntity.feature_id,
              face_ids: selectedEntity.face_ids,
            });
          } else if (selectedEntity.entity_type === 'body') {
            handleCommit('delete_feature', { body: true });
          } else {
            const parentFeat = detectedFeatures?.find((df) =>
              df.face_ids?.includes(selectedEntity.transient_id)
            );
            if (parentFeat && selectedEntities.length <= 1) {
              handleCommit('delete_feature', {
                feature_id: parentFeat.feature_id,
                face_ids: parentFeat.face_ids,
              });
            } else {
              const fids =
                selectedEntities.length > 1
                  ? selectedEntities.map((ent) => ent.transient_id).filter(Boolean)
                  : [selectedEntity.transient_id];
              handleCommit('delete_feature', { face_ids: fids });
            }
          }
          return;
        }
      }

      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        if (e.shiftKey) {
          handleRedo();
        } else {
          handleUndo();
        }
      } else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        handleRedo();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [
    contextMenu,
    setContextMenu,
    activeTool,
    setActiveTool,
    isPreviewActive,
    handleCancelPreview,
    selectedEntity,
    selectedEntities,
    detectedFeatures,
    handleCommit,
    canUndo,
    canRedo,
    handleUndo,
    handleRedo,
  ]);
}

