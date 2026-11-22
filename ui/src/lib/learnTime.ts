// The view "Learning time" (concept "Reiter Lernpläne" 7): the planned hours of each learning path against the hours
// done, what is left and when it will be done at the pace of the last weeks. Every figure is the engine's
// (`PathEntry.hours`, capability `path_hours`; `forecast_weeks` of `tasks.learn_history`; WEB-13): this file only puts
// them side by side and says how a bar is drawn.

import type { LearnHistory, PathEntry, PathHours } from './contract';

export interface TimeRow {
  id: string;
  title: string;
  icon: PathEntry['icon'];
  project?: string;
  hours: PathHours;
  /** How much of the plan (its upper end) is done, 0..1, for the bar. */
  share: number;
  /** The hours done beyond the plan's upper end; 0 within it. */
  over: number;
  forecast?: NonNullable<LearnHistory['paths'][number]['forecast_weeks']>;
}

/** The paths that plan or record hours, in the engine's order, each with its bar and its forecast where there is one. */
export function timeRows(paths: readonly PathEntry[], history: LearnHistory | null): TimeRow[] {
  const forecasts = new Map((history?.paths ?? []).map((p) => [p.id, p.forecast_weeks] as const));
  return paths.flatMap((p) => {
    const hours = p.hours;
    if (!hours) return [];
    const plan = hours.planned_max;
    const share = plan > 0 ? Math.min(1, hours.done / plan) : hours.done > 0 ? 1 : 0;
    const over = Math.max(0, round2(hours.done - plan));
    const forecast = forecasts.get(p.id);
    return [
      {
        id: p.id,
        title: p.title,
        icon: p.icon,
        ...(p.project ? { project: p.project } : {}),
        hours,
        share,
        over: plan > 0 ? over : 0,
        ...(forecast ? { forecast } : {}),
      },
    ];
  });
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** A span of hours as one number when both ends are the same: `8`, `8–10`. */
export function span(min: number, max: number, format: (n: number) => string): string {
  return min === max ? format(min) : `${format(min)}–${format(max)}`;
}

/**
 * The weeks until done as shown, or null when the engine gave no forecast (a pace of 0, a series younger than four
 * weeks): the hours when the path plans some (their span), else the points.
 */
export function forecastWeeks(forecast: TimeRow['forecast']): { min: number; max: number } | null {
  if (!forecast) return null;
  const lo = forecast.hours_min;
  const hi = forecast.hours_max;
  if (lo !== undefined || hi !== undefined) {
    const a = Math.ceil(lo ?? hi!);
    const b = Math.ceil(hi ?? lo!);
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  if (forecast.points !== undefined) {
    const n = Math.ceil(forecast.points);
    return { min: n, max: n };
  }
  return null;
}

/** The projects of the rows, for the filter, by id. */
export function rowProjects(rows: readonly Pick<TimeRow, 'project'>[]): string[] {
  return [...new Set(rows.flatMap((r) => (r.project ? [r.project] : [])))].toSorted();
}
