declare module 'fs-native-extensions' {
  const extensions: {
    tryLock(fd: number): boolean;
    unlock(fd: number): void;
  };
  export default extensions;
}
