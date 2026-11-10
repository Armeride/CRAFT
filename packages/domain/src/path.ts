/** Portable project paths, serialized with '/', never an OS absolute path. */
export function isProjectPath(path: string): boolean {
  if (!path || /[\\:\u0000-\u001f<>"|?*]/.test(path) || path.startsWith('/')) return false;
  return path.split('/').every(part => part !== '' && part !== '.' && part !== '..' && !/[. ]$/.test(part) && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}

export function resolveBodyPath(metaPath: string, bodyPath: string): string | undefined {
  if (!isProjectPath(bodyPath)) return undefined;
  return metaPath.slice(0, metaPath.lastIndexOf('/') + 1) + bodyPath;
}
