import { canonicalJson } from "../../domain/src/canonical.js";
import type { Field, JsonValue, Reference, Transition } from "./generated.js";
import type { Truth } from "./evaluation-contracts.js";
import type { Operand } from "./generated.js";

export type ReadValue = { value?: JsonValue; provisional?: boolean };
export interface Checked {
  truth: Truth;
  provisional: boolean;
}

export function normalizeReferences(
  value: JsonValue,
  field: Field | undefined,
  links: Record<string, Reference>,
): JsonValue | undefined {
  if (field?.type === "reference_set") {
    if (!Array.isArray(value)) return undefined;
    const targets = value.map((item) =>
      normalizeReferences(item, { type: "reference" }, links),
    );
    return targets.some((target) => target === undefined)
      ? undefined
      : (targets as JsonValue[]);
  }
  if (
    field?.type !== "reference" ||
    value === null ||
    typeof value !== "object" ||
    Array.isArray(value)
  )
    return value;
  const link = value["link"];
  if (typeof link !== "string" || !Object.hasOwn(links, link)) return undefined;
  const { entity_id, revision_id, anchor_id } = links[link]!.target;
  return { entity_id, revision_id, ...(anchor_id ? { anchor_id } : {}) };
}

function comparison(
  operator: string,
  left: JsonValue | undefined,
  right: JsonValue | undefined,
): Truth {
  if (left === undefined || right === undefined) return "unknown";
  if (operator === "in")
    return Array.isArray(right)
      ? truth(
          right.some((value) => canonicalJson(value) === canonicalJson(left)),
        )
      : "unknown";
  if (operator === "eq" || operator === "ne") {
    const same = canonicalJson(left) === canonicalJson(right);
    return truth(operator === "eq" ? same : !same);
  }
  if (typeof left !== "number" || typeof right !== "number") return "unknown";
  switch (operator) {
    case "lt":
      return truth(left < right);
    case "lte":
      return truth(left <= right);
    case "gt":
      return truth(left > right);
    case "gte":
      return truth(left >= right);
    default:
      return "unknown";
  }
}
const truth = (value: boolean): Truth => (value ? "true" : "false");

export function condition(
  rule: Transition,
  id: string | undefined,
  read: (operand: Operand, hint?: Operand, member?: boolean) => ReadValue,
): Checked & { checks?: Record<string, Truth> } {
  if (!id) return { truth: "true", provisional: false };
  const nodes = new Map(rule.nodes.map((node) => [node.id, node]));
  const memo = new Map<string, Checked>();
  function visit(key: string): Checked {
    const cached = memo.get(key);
    if (cached) return cached;
    const node = nodes.get(key);
    let result: Checked = { truth: "unknown", provisional: false };
    memo.set(key, result);
    if (!node) return result;
    switch (node.op) {
      case "constant":
        result = { truth: truth(node.value), provisional: false };
        break;
      case "not": {
        const child = visit(node.child);
        result = {
          truth:
            child.truth === "unknown"
              ? "unknown"
              : truth(child.truth === "false"),
          provisional: child.provisional,
        };
        break;
      }
      case "all":
      case "any": {
        const values = node.children.map(visit);
        const decisive = node.op === "all" ? "false" : "true";
        result = {
          truth: values.some((value) => value.truth === decisive)
            ? decisive
            : values.some((value) => value.truth === "unknown")
              ? "unknown"
              : node.op === "all"
                ? "true"
                : "false",
          provisional: values.some((value) => value.provisional),
        };
        break;
      }
      case "compare": {
        const left = read(node.left, node.right, node.operator === "in");
        const right = read(node.right, node.left, node.operator === "in");
        result = {
          truth: comparison(node.operator, left.value, right.value),
          provisional: !!left.provisional || !!right.provisional,
        };
        break;
      }
    }
    memo.set(key, result);
    return result;
  }
  const result = visit(id);
  return {
    ...result,
    checks: Object.fromEntries(
      [...memo].map(([name, value]) => [name, value.truth]),
    ),
  };
}
