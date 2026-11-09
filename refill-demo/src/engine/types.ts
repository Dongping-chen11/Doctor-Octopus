export type Category = 'physio' | 'massage' | 'chiro' | 'acupuncture' | 'aesthetics';
export type Payer = 'private' | 'MVA' | 'WCB';

export interface Clinic {
  id: string;
  name: string;
  short: string;
  lat: number;
  lng: number;
}

export interface Provider {
  id: string;
  name: string;
  clinics: string[];
  categories: Category[];
  typicalDuration: Record<string, number>;
  volume: number;
  languages: string[];
}

export interface Patient {
  id: string;
  name: string;
  homeClinic: string;
  lat: number;
  lng: number;
  need: { category: Category; payer: Payer; duration: number; initial: boolean };
  provider: string;
  acceptsOtherProviders: boolean;
  history: { visits: number; cancels: number; online: number; daysSinceLastVisit: number };
  flexMode: boolean;
  freeToday: boolean;
  windows: { morning: boolean; afternoon: boolean; evening: boolean };
  /** 0 = Monday ... 6 = Sunday */
  days: number[];
  nextBookingInDays: number | null;
  waitingDays: number | null;
  acute: boolean;
  language: string;
  offerAcceptRate: number;
  offersThisWeek: number;
  optedOut: boolean;
}

/** An open slot to fill. Times are minutes on one shared timeline (the engine only uses differences). */
export interface Slot {
  id: string;
  provider: string;
  clinic: string;
  category: Category;
  duration: number;
  start: number;
  /** 0 = Monday */
  dow: number;
  /** hour of day, 9.5 = 9:30 */
  hour: number;
}

export interface Settings {
  weights: { fit: number; need: number; wait: number };
  /** max short-notice offers a patient gets per week */
  fatigueCap: number;
  /** allow offers to patients whose home clinic is the other clinic */
  crossClinic: boolean;
  /** minutes of buffer on top of travel time */
  travelBuffer: number;
}

export interface ShowModel {
  features: string[];
  coef: Record<string, number>;
  intercept: number;
  prior: { a: number; b: number };
  testAuc: number;
  trainedOn: number;
  baseRate: number;
}

export type RuleId = 'optin' | 'service' | 'duration' | 'provider' | 'clinic' | 'reach' | 'available' | 'busy' | 'fatigue';

export interface Candidate {
  patient: Patient;
  travelMin: number;
  distanceKm: number;
  pAccept: number;
  pShow: number;
  fit: number;
  need: number;
  wait: number;
  value: number;
  score: number;
  reasons: string[];
}

export interface Rejected {
  patient: Patient;
  rule: RuleId;
  detail: string;
}

export interface MatchResult {
  candidates: Candidate[];
  rejected: Rejected[];
  /** pool size after each hard filter, in order */
  funnel: { rule: RuleId | 'pool'; label: string; remaining: number }[];
}

export interface WavePlanEntry {
  index: number;
  candidates: Candidate[];
  timerMin: number;
  /** chance at least one person in this wave accepts */
  pAny: number;
  startsInMin: number;
}

export interface WavePlan {
  waves: WavePlanEntry[];
  target: number;
  timerMin: number;
  pFill: number;
  expectedOffers: number;
}
