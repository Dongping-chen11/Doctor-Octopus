import type { Appointment } from './engine/data';
import type { Run } from './state';

export type ApptView = 'booked' | 'past' | 'open' | 'cancelled' | 'offering' | 'filled' | 'lost';

export function apptView(a: Appointment, run: Run | undefined, clock: number): ApptView {
  if (a.state === 'filled') return 'filled';
  if (run?.status === 'waiting') return 'offering';
  if (run?.status === 'unfilled' || ((a.state === 'cancelled' || a.state === 'open') && a.startMin < clock)) return 'lost';
  if (a.state === 'cancelled') return 'cancelled';
  if (a.state === 'open') return 'open';
  if (a.startMin + a.duration <= clock) return 'past';
  return 'booked';
}

export const VIEW_LABEL: Record<ApptView, string> = {
  booked: 'Booked', past: 'Done', open: 'Open', cancelled: 'Cancelled', offering: 'Offers out', filled: 'Recovered', lost: 'Unfilled',
};
export const VIEW_PILL: Record<ApptView, string> = {
  booked: '', past: '', open: 'open', cancelled: 'cancelled', offering: 'offering', filled: 'filled', lost: 'unfilled',
};
