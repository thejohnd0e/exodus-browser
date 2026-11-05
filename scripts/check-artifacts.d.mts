export type AsarIndex = {
  has(name: string): boolean;
  read(name: string): Buffer | null;
};

export function fileOffset(base: number, entry: { offset?: string | number }): number;

export function readAsarIndex(asarPath: string): AsarIndex;

export function checkPackagedApp(options: {
  asarPath: string;
  expectedVersion?: string;
  nativeModulePath?: string;
}): string[];
