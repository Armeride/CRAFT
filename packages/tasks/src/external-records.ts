import type { ProjectSnapshot } from "../../domain/src/model.js";
import { rawObject } from "../../project-fs/src/content.js";
import type { Checkpoint } from "../../schema/src/generated.js";

export type ExternalReceipt = NonNullable<
  Checkpoint["external_operations"]
>[number] & {
  profileId: string;
  connectionDigest: string;
  tool: string;
  digest: string;
  operation_id: string;
  result?: unknown;
};

export function externalReceipts(
  snapshot: ProjectSnapshot,
  taskId: string,
): ExternalReceipt[] {
  const prefix = `tasks/${taskId}/working/external-`;
  return [...snapshot.files.keys()]
    .filter(
      (path) =>
        path.startsWith(prefix) &&
        /^[a-f0-9-]{36}\.json$/.test(path.slice(prefix.length)),
    )
    .sort()
    .map((path) => {
      const record = rawObject<ExternalReceipt>(snapshot.files, path);
      if (
        record.operation_id + ".json" !== path.slice(prefix.length) ||
        !/^[a-f0-9]{64}$/.test(record.digest) ||
        !["pending", "failed", "completed", "external_state_unknown"].includes(
          record.state,
        )
      )
        throw new Error("Invalid external receipt");
      return record;
    });
}

export function externalOperations(
  snapshot: ProjectSnapshot,
  taskId: string,
): NonNullable<Checkpoint["external_operations"]> {
  return externalReceipts(snapshot, taskId).map(
    ({ operation_id, idempotency_key, job_id, state }) => ({
      operation_id,
      state: state === "pending" && !job_id ? "external_state_unknown" : state,
      ...(idempotency_key ? { idempotency_key } : {}),
      ...(job_id ? { job_id } : {}),
    }),
  );
}
