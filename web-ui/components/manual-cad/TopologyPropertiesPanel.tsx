'use client';

/**
 * Backward-compatibility wrapper for TopologyPropertiesPanel.
 * The core implementation has been modularized into ./layout/PropertiesPanel.
 */
import {
  PropertiesPanel,
  PropertiesPanelProps,
  EntityInspector,
  DetectedFeaturesList,
  SubpartParamEditor,
} from './layout/PropertiesPanel';

export type TopologyPropertiesPanelProps = PropertiesPanelProps;
export const TopologyPropertiesPanel = PropertiesPanel;
export { EntityInspector, DetectedFeaturesList, SubpartParamEditor };
export default PropertiesPanel;
