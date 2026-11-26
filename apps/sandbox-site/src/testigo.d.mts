import type { ServerResponse } from 'node:http';

export const TESTIGO_OCR: string;
export const HTML_TESTIGO: string;
export function conTestigoEnHtml(html: string): string;
export function instalarTestigo(res: ServerResponse): void;
