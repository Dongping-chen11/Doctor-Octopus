import { clinicById, clinics, providers } from '../engine/data';
import { distanceKm, travelMinutes } from '../engine/match';
import type { Category, Patient } from '../engine/types';

/** Directory entries for the patient app's search and recommendations (UI demo). */
export interface Listing {
  id: string;
  kind: 'clinic' | 'provider';
  name: string;
  subtitle: string;
  categories: Category[];
  lat: number;
  lng: number;
  languages: string[];
  directBilling: boolean;
  newPatients: boolean;
  partner: boolean;
  providerId?: string;
  clinicId?: string;
}

// Fictional sample listings so search results look like a real directory.
const SAMPLE_CLINICS: Listing[] = [
  { id: 'kestrel', kind: 'clinic', name: 'Kestrel Physio Studio', subtitle: 'Physiotherapy · Sports injuries', categories: ['physio'], lat: 53.5232, lng: -113.5263, languages: ['English', 'French'], directBilling: true, newPatients: true, partner: false },
  { id: 'larchwood', kind: 'clinic', name: 'Larchwood Massage & Wellness', subtitle: 'Registered massage therapy', categories: ['massage'], lat: 53.5444, lng: -113.4909, languages: ['English', 'Tagalog'], directBilling: true, newPatients: true, partner: false },
  { id: 'brightpath', kind: 'clinic', name: 'Brightpath Chiropractic', subtitle: 'Chiropractic · Posture care', categories: ['chiro'], lat: 53.4875, lng: -113.5112, languages: ['English', 'Punjabi'], directBilling: false, newPatients: true, partner: false },
  { id: 'saltbox', kind: 'clinic', name: 'Saltbox Acupuncture Room', subtitle: 'Acupuncture · Cupping', categories: ['acupuncture', 'massage'], lat: 53.5701, lng: -113.4660, languages: ['English', 'Mandarin'], directBilling: false, newPatients: false, partner: false },
  { id: 'northline', kind: 'clinic', name: 'Northline Rehab Centre', subtitle: 'Physiotherapy · MVA and WCB', categories: ['physio', 'massage'], lat: 53.6040, lng: -113.4420, languages: ['English', 'Ukrainian'], directBilling: true, newPatients: true, partner: false },
];

export const LISTINGS: Listing[] = [
  ...clinics.map(c => ({
    id: c.id, kind: 'clinic' as const, name: c.name,
    subtitle: c.id === 'bethesda' ? 'Physio · Massage · Chiro · Acupuncture' : 'Physiotherapy · Massage · MVA and WCB',
    categories: [...new Set(providers.filter(p => p.clinics.includes(c.id)).flatMap(p => p.categories))] as Category[],
    lat: c.lat, lng: c.lng, languages: ['English', 'Punjabi', 'Malayalam'], directBilling: true, newPatients: true, partner: true, clinicId: c.id,
  })),
  ...providers.filter(p => p.categories[0] !== 'aesthetics').map(p => {
    const c = clinicById[p.clinics[0]];
    return {
      id: p.id, kind: 'provider' as const, name: p.name, subtitle: `${p.categories.map(x => x[0].toUpperCase() + x.slice(1)).join(' · ')} · ${c.short}`,
      categories: p.categories, lat: c.lat, lng: c.lng, languages: p.languages, directBilling: true, newPatients: true, partner: true, providerId: p.id, clinicId: c.id,
    };
  }),
  ...SAMPLE_CLINICS,
];

export function listingDistance(l: Listing, p: Patient) {
  const km = distanceKm(p.lat, p.lng, l.lat, l.lng);
  return { km, min: travelMinutes(km) };
}

/** Simple, explainable recommendation for the home screen. */
export function recommend(p: Patient, limit = 4) {
  return LISTINGS
    .filter(l => l.categories.includes(p.need.category))
    .map(l => {
      const d = listingDistance(l, p);
      let s = 0;
      const why: string[] = [];
      if (l.providerId === p.provider) { s += 3; why.push('Your practitioner'); }
      if (l.clinicId === p.homeClinic && l.kind === 'clinic') { s += 1.5; why.push('Your clinic'); }
      if (p.language !== 'English' && l.languages.includes(p.language)) { s += 1.2; why.push(`Speaks ${p.language}`); }
      if (p.need.payer !== 'private' && l.directBilling) { s += 0.8; why.push(`Bills ${p.need.payer} directly`); }
      if (l.partner) { s += 0.8; why.push('Earlier-slot offers'); }
      s -= d.min / 20;
      return { l, d, s, why };
    })
    .sort((a, b) => b.s - a.s)
    .slice(0, limit);
}

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
