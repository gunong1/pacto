export interface RawImage { width: number; height: number; data: Uint8Array }
export declare function decodeJpeg(bytes: Uint8Array, opts?: { useTArray?: boolean; formatAsRGBA?: boolean; maxMemoryUsageInMB?: number; maxResolutionInMP?: number }): RawImage;
export declare function encodeJpeg(image: RawImage, quality?: number): { data: Uint8Array; width: number; height: number };
export declare function decodeJpegFast(bytes: Uint8Array): Promise<RawImage>;
export declare function decodePng(bytes: Uint8Array): { width: number; height: number; channels: number; depth: number; data: Uint8Array | Uint16Array; palette?: number[][] };
