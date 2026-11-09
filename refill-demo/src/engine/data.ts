import clinicsJson from '../data/clinics.json';
import patientsJson from '../data/patients.json';
import modelJson from '../data/showModel.json';
import historyJson from '../data/history.json';
import scheduleJson from '../data/schedule.json';
import type { Clinic, Patient, Provider, ShowModel, Category } from './types';
import type { HistoryRow } from './replay';
import type { BaselineBucket } from './match';

export interface Appointment {
  id: string;
  provider: string;
  clinic: string;
  startMin: number;
  duration: number;
  category: Category;
  patientId: string | null;
  state: 'booked' | 'open' | 'cancelled' | 'offering' | 'filled' | 'done';
  filledBy?: string;
}

export const clinics: Clinic[] = clinicsJson.clinics;
export const providers = clinicsJson.providers as unknown as Provider[];
export const showcase: string[] = clinicsJson.showcaseProviders;
export const patients = patientsJson as unknown as Patient[];
export const model = modelJson as unknown as ShowModel;
export const history = historyJson.history as unknown as HistoryRow[];
export const baseline = historyJson.baseline as BaselineBucket[];
export const dataRange = historyJson.dataRange as string[];
export const schedule = scheduleJson as unknown as Appointment[];

export const clinicById = Object.fromEntries(clinics.map(c => [c.id, c]));
export const providerById = Object.fromEntries(providers.map(p => [p.id, p]));
export const patientById = Object.fromEntries(patients.map(p => [p.id, p]));
