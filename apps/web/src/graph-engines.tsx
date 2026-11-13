import type { ComponentType } from 'react';
import type { GraphModel } from './graph-model.js';
import { GraphCanvas } from './GraphCanvas.js';
import { columnLayout, networkLayout } from './graph-layout.js';
export interface GraphEngineProps { model: GraphModel; language: string; choose: (entity: string, revision?: string) => void }
export interface GraphEngine { readonly id: string; readonly helpKey: string; readonly View: ComponentType<GraphEngineProps> }
// Only implemented engines belong here. Research candidates are documented, not selectable.
export const graphEngines = [
  { id: 'network', helpKey: 'graph.networkHelp', View: (props: GraphEngineProps) => <GraphCanvas {...props} layoutEngine={networkLayout}/> },
  { id: 'columns', helpKey: 'graph.columnsHelp', View: (props: GraphEngineProps) => <GraphCanvas {...props} layoutEngine={columnLayout}/> },
] as const satisfies readonly GraphEngine[];
export type GraphEngineId = typeof graphEngines[number]['id'];
export const defaultGraphEngine: GraphEngineId = 'network';
export function resolveGraphEngine(id: unknown): typeof graphEngines[number] { return graphEngines.find(engine => engine.id === id) ?? graphEngines[0]; }
