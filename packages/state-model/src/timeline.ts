import type { EvaluationPoint } from "./evaluation-contracts.js";

export interface Ordered {
  worldTick: number;
  eventOrder: number;
}
export const orderOf = (a: Ordered, b: Ordered) =>
  a.worldTick - b.worldTick || a.eventOrder - b.eventOrder;

export function inTime(event: Ordered, point: EvaluationPoint) {
  if (event.worldTick !== point.worldTick)
    return event.worldTick < point.worldTick;
  if (point.eventOrder !== undefined)
    return (
      event.eventOrder < point.eventOrder ||
      (event.eventOrder === point.eventOrder && point.boundary !== "before")
    );
  return point.boundary !== "before";
}

export function orderedGroups<T extends Ordered>(items: T[]): T[][] {
  const result: T[][] = [];
  for (const item of items.sort(orderOf)) {
    const previous = result.at(-1);
    if (previous && orderOf(previous[0]!, item) === 0) previous.push(item);
    else result.push([item]);
  }
  return result;
}
