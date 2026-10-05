// Types for route.js (plain JS, served without a build step).

export interface Route {
  view: string;
  sub: string | null;
  params: Record<string, string>;
}
export interface RouteInput {
  view: string;
  sub?: string | null;
  params?: Record<string, string | null | undefined>;
}
export interface PaletteLike {
  title: string;
  group?: string;
  hint?: string;
  keywords?: string;
}
export interface Ranked<T> {
  item: T;
  score: number;
  idx: number[];
}

export const ROUTE_PARAMS: string[];
export function parseRoute(hash: string): Route | null;
export function formatRoute(route: RouteInput): string;
export function keyTail(k: string): string;
export function resolveKey(
  keys: Iterable<string>,
  want: string | null | undefined,
  isLive?: (k: string) => boolean,
): string | null;
export function fuzzyMatch(query: string, text: string): { score: number; idx: number[] } | null;
export function rankItems<T extends PaletteLike>(query: string, items: T[]): Ranked<T>[];
export function groupResults<T extends PaletteLike>(
  ranked: Ranked<T>[],
  opts?: { order?: string[]; perGroup?: number; byScore?: boolean },
): { group: string; items: Ranked<T>[] }[];
export const G_VIEWS: Record<string, string>;
export function viewForLetter(letter: string, views: { id: string; label?: string }[]): string | null;
export function letterForView(id: string, views: { id: string; label?: string }[]): string | null;
export function isTypingTarget(el: unknown): boolean;
export function layoutNav(widths: number[], avail: number, active: number, moreW: number): number[];
