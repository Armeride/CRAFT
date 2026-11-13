import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { GraphEngineProps } from './graph-engines.js';
import type { GraphLayout, Point } from './graph-layout.js';
import { nodeWidth, nodeHeight } from './graph-layout.js';

interface Viewport { x: number; y: number; scale: number }
const minimumScale = .05;
const limitScale = (scale: number) => Math.max(minimumScale, Math.min(2.5, scale));
export function GraphCanvas({ model, language, choose, layoutEngine }: GraphEngineProps & { layoutEngine: (model: GraphEngineProps['model']) => GraphLayout }) {
  const { t } = useTranslation(), id = useId().replaceAll(':', ''), ref = useRef<HTMLDivElement>(null);
  const layout = useMemo(() => layoutEngine(model), [layoutEngine, model]);
  const layoutKey = JSON.stringify([layout.width, layout.height, [...layout.positions].sort(([a], [b]) => a.localeCompare(b))]);
  const [size, setSize] = useState({ width: 600, height: 440 }), [view, setView] = useState<Viewport>({ x: 0, y: 0, scale: 1 }), [dragging, setDragging] = useState(false);
  const drag = useRef<{ pointer: number; clientX: number; clientY: number; x: number; y: number } | null>(null);
  const fit = () => { const scale = limitScale(Math.min((size.width - 32) / layout.width, (size.height - 32) / layout.height)); setView({ scale, x: (size.width - layout.width * scale) / 2, y: (size.height - layout.height * scale) / 2 }); };
  useLayoutEffect(() => { const element = ref.current; if (!element) return; const observer = new ResizeObserver(() => setSize({ width: element.clientWidth, height: element.clientHeight })); observer.observe(element); setSize({ width: element.clientWidth, height: element.clientHeight }); return () => observer.disconnect(); }, []);
  useLayoutEffect(fit, [layoutKey, size.width, size.height]);
  function zoom(factor: number, point: Point = { x: size.width / 2, y: size.height / 2 }) { setView(previous => { const scale = limitScale(previous.scale * factor), ratio = scale / previous.scale; return { scale, x: point.x - (point.x - previous.x) * ratio, y: point.y - (point.y - previous.y) * ratio }; }); }
  useEffect(() => { const element = ref.current; if (!element) return; const wheel = (event: WheelEvent) => { if (!event.ctrlKey && !event.metaKey) return; event.preventDefault(); const rect = element.getBoundingClientRect(); zoom(event.deltaY < 0 ? 1.15 : 1 / 1.15, { x: event.clientX - rect.left, y: event.clientY - rect.top }); }; element.addEventListener('wheel', wheel, { passive: false }); return () => element.removeEventListener('wheel', wheel); }, []);
  function reveal(key: string) { const p = layout.positions.get(key)!; setView(previous => { const x = p.x * previous.scale + previous.x, y = p.y * previous.scale + previous.y; return x < 0 || y < 0 || x + nodeWidth * previous.scale > size.width || y + nodeHeight * previous.scale > size.height ? { ...previous, x: size.width / 2 - (p.x + nodeWidth / 2) * previous.scale, y: size.height / 2 - (p.y + nodeHeight / 2) * previous.scale } : previous; }); }
  function edgePath(source: string, target: string) {
    const a = layout.positions.get(source)!, b = layout.positions.get(target)!;
    if (source === target) return `M${a.x + 40},${a.y} C${a.x + 5},${a.y - 64} ${a.x + 155},${a.y - 64} ${a.x + 120},${a.y}`;
    const ax = a.x + nodeWidth / 2, ay = a.y + nodeHeight / 2, bx = b.x + nodeWidth / 2, by = b.y + nodeHeight / 2, dx = bx - ax, dy = by - ay;
    const cut = Math.max(Math.abs(dx) / (nodeWidth / 2 + 5), Math.abs(dy) / (nodeHeight / 2 + 5), 1), distance = Math.max(1, Math.hypot(dx, dy));
    return `M${ax + dx / cut},${ay + dy / cut} Q${(ax + bx) / 2 - dy / distance * 18},${(ay + by) / 2 + dx / distance * 18} ${bx - dx / cut},${by - dy / cut}`;
  }
  return <>
    <div className="graph-toolbar" role="group" aria-label={t('graph.controls')}><button className="secondary-button" aria-label={t('graph.zoomOut')} disabled={view.scale <= minimumScale} onClick={() => zoom(1 / 1.25)}>−</button><output aria-label={t('graph.zoom')}>{new Intl.NumberFormat(undefined, { style: 'percent', maximumFractionDigits: 0 }).format(view.scale)}</output><button className="secondary-button" aria-label={t('graph.zoomIn')} disabled={view.scale >= 2.5} onClick={() => zoom(1.25)}>+</button><button className="secondary-button" onClick={fit}>{t('graph.fit')}</button><button className="text-button" onClick={() => setView({ scale: 1, x: (size.width - layout.width) / 2, y: (size.height - layout.height) / 2 })}>{t('graph.actualSize')}</button></div>
    <p id={id + '-help'} className="graph-help">{t('graph.navigation')}</p>
    <div ref={ref} className={`graph-viewport ${dragging ? 'dragging' : ''}`} role="group" aria-label={t('graph.canvas')} aria-describedby={id + '-help'} tabIndex={0} data-scale={view.scale} data-pan-x={view.x} data-pan-y={view.y}
      onPointerDown={event => { if (!event.isPrimary || event.button !== 0 || (event.target as Element).closest('button')) return; event.currentTarget.focus(); event.currentTarget.setPointerCapture(event.pointerId); drag.current = { pointer: event.pointerId, clientX: event.clientX, clientY: event.clientY, x: view.x, y: view.y }; setDragging(true); }}
      onPointerMove={event => { const start = drag.current; if (start?.pointer === event.pointerId) setView(previous => ({ ...previous, x: start.x + event.clientX - start.clientX, y: start.y + event.clientY - start.clientY })); }}
      onPointerUp={event => { if (drag.current?.pointer === event.pointerId) { drag.current = null; setDragging(false); if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId); } }} onLostPointerCapture={() => { drag.current = null; setDragging(false); }} onPointerCancel={() => { drag.current = null; setDragging(false); }}
      onKeyDown={event => { if (event.target !== event.currentTarget) return; const deltas: Record<string, Point> = { ArrowLeft: { x: 50, y: 0 }, ArrowRight: { x: -50, y: 0 }, ArrowUp: { x: 0, y: 50 }, ArrowDown: { x: 0, y: -50 } }; const delta = deltas[event.key]; if (delta) { event.preventDefault(); setView(previous => ({ ...previous, x: previous.x + delta.x, y: previous.y + delta.y })); } else if (['+', '=', '-', '0', 'f', 'F'].includes(event.key)) { event.preventDefault(); if (event.key === '0' || event.key.toLowerCase() === 'f') fit(); else zoom(event.key === '-' ? 1 / 1.25 : 1.25); } }}>
      <div className="graph-scene" style={{ width: layout.width, height: layout.height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
        <svg width={layout.width} height={layout.height} aria-hidden="true"><defs><marker id={id} viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="currentColor"/></marker></defs>{layout.groups.map(group => <g key={group.id} className="graph-cluster"><rect x={group.x} y={group.y} width={group.width} height={group.height} rx="30"/><text x={group.x + 14} y={group.y + 18}>{t('graph.cluster', { count: group.id })}</text></g>)}{model.edges.map(edge => <path key={edge.source + ':' + edge.reference.reference_id} d={edgePath(edge.source, edge.target)} className={edge.reference.propagation === 'blocking' ? 'graph-edge' : 'graph-edge advisory'} markerEnd={`url(#${id})`}/>)}</svg>
        {model.nodes.map(node => { const position = layout.positions.get(node.key)!; return <button key={node.key} title={node.title} className={`graph-node ${node.external ? 'external-node' : ''}`} style={{ left: position.x, top: position.y, width: nodeWidth, height: nodeHeight }} aria-label={t('graph.open', { title: node.title, revision: node.revisionId })} onFocus={event => { if (event.currentTarget.matches(':focus-visible')) reveal(node.key); }} onClick={() => choose(node.entityId, node.revisionId)}><strong lang={language}>{node.title}</strong><small>{node.historical ? t('graph.historical') : node.external ? t('graph.external') : t('kind.' + node.kind, { defaultValue: t('kind.other') })}<span className="graph-degree">{t('graph.degree', { count: layout.degrees.get(node.key) ?? 0 })}</span></small></button>; })}
      </div>
    </div>
  </>;
}
