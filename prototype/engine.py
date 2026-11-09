"""Pure, deterministic matching logic for a synthetic natHacks demo.
No clinical claims and no production patient data.
"""
from datetime import datetime, timedelta
from pathlib import Path
from data_adapter import load_csv

ROOT = Path(__file__).resolve().parent
FMT = '%Y-%m-%d %H:%M'

def date(value):
    return datetime.strptime(value, FMT) if value else None

def flag(value):
    return str(value).lower() in ('true','yes','1','y')

def load_rows(filename):
    kind = 'slot' if 'slot' in filename.lower() else 'patient'
    return load_csv(ROOT / 'data' / filename, kind)


def eligibility(patient, slot):
    """Return explicit disqualification reasons, not a fabricated clinical decision."""
    issues = []
    if not flag(patient['active_request']): issues.append('No active appointment request')
    if not flag(patient['opt_in']): issues.append('No consent for appointment offers')
    if patient['service_type'] != slot['service_type']: issues.append('Service mismatch')
    if patient['visit_type'] != slot['visit_type']: issues.append('Visit type mismatch')
    if int(patient['required_duration_min']) > int(slot['duration_min']): issues.append('Insufficient appointment duration')
    if patient['clinic_preference'] not in ('any', slot['clinic_id']): issues.append('Different clinic required')
    if flag(patient['provider_required']) and patient['preferred_provider_id'] != slot['provider_id']:
        issues.append('Required practitioner mismatch')
    start, end, release = date(slot['start_at']), date(slot['end_at']), date(slot['released_at'])
    avail_start, avail_end = date(patient['available_start']), date(patient['available_end'])
    if not avail_start or not avail_end:
        issues.append('Availability not provided')
    elif start < avail_start or end > avail_end:
        issues.append('Unavailable for entire appointment')
    # Optional extra fields: legacy CSVs continue to work unchanged.
    travel_minutes = int(patient['travel_min'])
    max_travel = patient.get('max_travel_minutes', '')
    if max_travel and travel_minutes > int(max_travel):
        issues.append('Travel exceeds patient maximum')
    notice = int(patient.get('minimum_notice_minutes') or 0)
    buffer = int(patient.get('travel_buffer_minutes') or 5)
    if release + timedelta(minutes=max(notice, travel_minutes + buffer)) > start:
        issues.append('Insufficient travel time after opening' if travel_minutes + buffer >= notice else 'Insufficient minimum notice')
    # Resource reset time must fit in the advertised window; it is not a patient preference.
    reset = int(slot.get('reset_minutes') or 0)
    if (end - start).total_seconds() / 60 < int(slot['duration_min']) + reset:
        issues.append('Insufficient room reset time')
    # Explicit unknown accessibility is a verification requirement, not an assumption of suitability.
    if flag(patient.get('accessibility_required', 'False')):
        if not flag(slot.get('accessible', 'False')):
            issues.append('Accessibility not confirmed for this opening')
    if flag(slot['referral_required']) and not flag(patient['referral_verified']):
        issues.append('Referral verification required')
    if flag(slot['insurance_required']) and not flag(patient['insurance_verified']):
        issues.append('Payment coverage verification required')
    bs, be = date(patient['existing_booking_start']), date(patient['existing_booking_end'])
    if bs and be and bs < end and start < be:
        issues.append('Overlapping existing appointment')
    return issues

def score(patient, slot):
    """Prototype preference ranking; NOT acceptance probability or medical urgency."""
    travel = max(0.0, 1.0 - int(patient['travel_min']) / 60.0)
    continuity = float(patient['preferred_provider_id'] == slot['provider_id'])
    clinic = float(patient['clinic_preference'] == slot['clinic_id'])
    wait_date = patient.get('waitlist_since', '')
    wait = max(0, min(1, (date(slot['released_at']).date() - datetime.strptime(wait_date, '%Y-%m-%d').date()).days / 30)) if wait_date else 0.0
    value = .30 * continuity + .20 * clinic + .25 * travel + .25 * wait
    reasons = []
    if continuity: reasons.append('Preferred practitioner')
    if clinic: reasons.append('Preferred clinic')
    reasons.append(f"Travel estimate: {patient['travel_min']} min")
    reasons.append(f'Waiting: {round(wait*30)} days (capped at 30)')
    return round(100 * value, 1), reasons

def match(slot, patients):
    eligible, excluded = [], []
    for patient in patients:
        issues = eligibility(patient, slot)
        if issues:
            excluded.append({'patient_id':patient['patient_id'], 'reasons':issues})
        else:
            value, reasons = score(patient, slot)
            eligible.append({'patient_id':patient['patient_id'], 'score':value, 'reasons':reasons})
    eligible.sort(key=lambda x:(-x['score'],x['patient_id']))
    return {'eligible':eligible, 'excluded':excluded}
