import type { Candidate } from './engine/types';

export type OfferResponse = 'pending' | 'accepted' | 'declined' | 'expired' | 'taken';

export interface Offer {
  patientId: string;
  wave: number;
  sentAt: number;
  deadline: number;
  response: OfferResponse;
  /** pre-drawn outcome for simulated patients (the phone patient answers by hand) */
  willAccept: boolean;
  respondAt: number;
  manual: boolean;
  candidate: Candidate;
}

export interface Run {
  apptId: string;
  openedAt: number;
  offers: Offer[];
  wave: number;
  status: 'idle' | 'waiting' | 'filled' | 'unfilled';
  filledBy?: string;
  filledAt?: number;
}

export interface LogEntry {
  at: number;
  text: string;
  kind: 'cancel' | 'offer' | 'accept' | 'decline' | 'info' | 'fill';
}
