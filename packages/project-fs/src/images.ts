import { crc32 } from "node:zlib";
import { fileFailure } from "./files.js";

export const managedAssetPattern = /^assets\/craft\/([a-f0-9]{64})\.png$/;
const embeddedImage =
  /^!\[([^\]\r\n]{1,200})\]\((assets\/craft\/[a-f0-9]{64}\.png)\)$/;

export function imageReference(
  line: string,
): { alt: string; path: string } | undefined {
  const match = embeddedImage.exec(line);
  if (match) return { alt: match[1]!, path: match[2]! };
}

export function imageReferences(text: string) {
  return text.split(/\r?\n/).flatMap((line) => {
    const image = imageReference(line);
    return image ? [image] : [];
  });
}

export function validateManagedImage(bytes: Buffer): void {
  const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  if (
    bytes.length < 45 ||
    bytes.length > 256 * 1024 ||
    !bytes.subarray(0, 8).equals(png) ||
    bytes.readUInt32BE(8) !== 13 ||
    bytes.toString("ascii", 12, 16) !== "IHDR" ||
    !bytes
      .subarray(-12)
      .equals(Buffer.from([0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]))
  ) {
    throw fileFailure(
      "ASSET_INVALID",
      "Expected a bounded PNG file",
      "project.yaml",
    );
  }
  const width = bytes.readUInt32BE(16),
    height = bytes.readUInt32BE(20);
  if (!width || !height || width > 2048 || height > 2048) {
    throw fileFailure(
      "ASSET_INVALID",
      "PNG dimensions exceed the supported limit",
      "project.yaml",
    );
  }
  let offset = 8,
    data = false;
  while (offset + 12 <= bytes.length) {
    const length = bytes.readUInt32BE(offset);
    const type = bytes.toString("ascii", offset + 4, offset + 8);
    const end = offset + length + 12;
    if (
      end > bytes.length ||
      type === "acTL" ||
      crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)
    )
      break;
    offset = end;
    if (type === "IDAT" && length > 0) data = true;
    if (type === "IEND" && offset === bytes.length && data) return;
  }
  throw fileFailure(
    "ASSET_INVALID",
    "Unsupported or incomplete PNG structure",
    "project.yaml",
  );
}
