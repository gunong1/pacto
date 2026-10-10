/** emscripten 모듈 팩토리 (qpdf CLI) */
declare const createModule: (opts: Record<string, unknown>) => Promise<{ FS: { writeFile(p: string, d: Uint8Array): void; readFile(p: string): Uint8Array; unlink(p: string): void }; callMain(args: string[]): number }>;
export default createModule;
