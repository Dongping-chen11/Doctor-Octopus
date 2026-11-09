"""Validated adapters for synthetic CSV files. No real patient records.

Inputs are converted to the existing internal schema; unknown extra columns are kept.
The server and matching engine both consume the same normalized records.
"""
import csv
from datetime import datetime
from pathlib import Path

DATE_TIME = '%Y-%m-%d %H:%M'
DATE_ONLY = '%Y-%m-%d'
ALIASES = {
    'patient': {
        'patient_id': ('patient_id', 'synthetic_patient_id', 'id'),
        'service_type': ('service_type', 'requested_service'),
        'visit_type': ('visit_type', 'requested_visit_type'),
        'required_duration_min': ('required_duration_min', 'requested_duration_min'),
        'travel_min': ('travel_min', 'estimated_travel_minutes'),
        'opt_in': ('opt_in', 'opt_in_short_notice_offers'),
        'active_request': ('active_request', 'active_earlier_appointment_request'),
        'clinic_preference': ('clinic_preference', 'preferred_clinic_id'),
        'preferred_provider_id': ('preferred_provider_id', 'preferred_practitioner_id'),
        'provider_required': ('provider_required', 'practitioner_required'),
        'available_start': ('available_start',),
        'available_end': ('available_end',),
        'referral_verified': ('referral_verified',),
        'insurance_verified': ('insurance_verified',),
        'existing_booking_start': ('existing_booking_start',),
        'existing_booking_end': ('existing_booking_end',),
        'waitlist_since': ('waitlist_since',),
    },
    'slot': {
        'slot_id': ('slot_id', 'appointment_id'),
        'clinic_id': ('clinic_id',),
        'provider_id': ('provider_id', 'practitioner_id'),
        'service_type': ('service_type', 'treatment_type'),
        'visit_type': ('visit_type',),
        'duration_min': ('duration_min', 'appointment_duration_min'),
        'start_at': ('start_at',), 'end_at': ('end_at',),
        'released_at': ('released_at',),
        'referral_required': ('referral_required',),
        'insurance_required': ('insurance_required',),
        'status': ('status',),
    }
}
REQUIRED = {
    'patient': ('patient_id', 'service_type', 'visit_type', 'required_duration_min',
                'travel_min', 'active_request', 'opt_in', 'available_start', 'available_end'),
    'slot': ('slot_id', 'clinic_id', 'provider_id', 'service_type', 'visit_type',
             'duration_min', 'start_at', 'end_at', 'released_at'),
}
DEFAULTS = {
    'patient': {
        'clinic_preference':'any', 'preferred_provider_id':'', 'provider_required':'False',
        'referral_verified':'False', 'insurance_verified':'False',
        'existing_booking_start':'','existing_booking_end':'','waitlist_since':'',
    },
    'slot': {'referral_required':'False', 'insurance_required':'False', 'status':'open'},
}
TRUE = {'true','yes','1','y'}
FALSE = {'false','no','0','n'}
OPTIONAL_INTS = {'max_travel_minutes','minimum_notice_minutes','travel_buffer_minutes',
                 'reset_minutes','patient_arrival_buffer_minutes'}

class DatasetError(ValueError):
    pass


def parse_flag(value, label):
    x=str(value).strip().lower()
    if x in TRUE: return 'True'
    if x in FALSE: return 'False'
    raise DatasetError(f"{label}: expected Yes/No or True/False, got {value!r}")


def _timestamp(value, name, row):
    if not value: return None
    try: return datetime.strptime(value, DATE_TIME)
    except ValueError: raise DatasetError(f"row {row}: {name} must use YYYY-MM-DD HH:MM (got {value!r})")


def _normalize(row, kind, rownum):
    result={str(k).strip(): ('' if v is None else str(v).strip()) for k,v in row.items() if k is not None}
    lower={key.lower(): key for key in result}
    for target, alternatives in ALIASES[kind].items():
        if target not in result:
            key=next((lower[a.lower()] for a in alternatives if a.lower() in lower),None)
            if key is not None: result[target]=result[key]
    for name,default in DEFAULTS[kind].items():
        result.setdefault(name,default)
    missing=[k for k in REQUIRED[kind] if not result.get(k)]
    if missing: raise DatasetError(f"row {rownum}: missing required {kind} fields: {', '.join(missing)}")
    for key in ('required_duration_min','duration_min','travel_min', *OPTIONAL_INTS):
        if result.get(key):
            try: n=int(result[key])
            except ValueError: raise DatasetError(f"row {rownum}: {key} must be an integer")
            if n < 0 or (key in ('duration_min','required_duration_min') and n == 0):
                raise DatasetError(f"row {rownum}: {key} must be positive (or nonnegative for buffers/travel)")
            result[key]=str(n)
    flags=('active_request','opt_in','provider_required','referral_verified','insurance_verified') if kind=='patient' else ('referral_required','insurance_required')
    for key in flags:
        result[key]=parse_flag(result.get(key, 'False'),f'row {rownum}, {key}')
    if kind=='patient':
        for k in ('available_start','available_end','existing_booking_start','existing_booking_end'):
            _timestamp(result.get(k,''),k,rownum)
        # Existing synthetic fixtures intentionally contain inverted availability windows.
        # Preserve them as impossible windows (engine excludes) rather than changing data.
        # Dataset checker reports these as warnings.
        if bool(result['existing_booking_start']) != bool(result['existing_booking_end']):
            raise DatasetError(f'row {rownum}: existing booking needs both start and end')
        if result.get('waitlist_since'):
            try: datetime.strptime(result['waitlist_since'],DATE_ONLY)
            except ValueError: raise DatasetError(f'row {rownum}: waitlist_since must be YYYY-MM-DD')
        # Missing wait-list history gets neutral score, not a guessed historical date.
    else:
        s=_timestamp(result['start_at'],'start_at',rownum)
        e=_timestamp(result['end_at'],'end_at',rownum)
        _timestamp(result['released_at'],'released_at',rownum)
        if s >= e: raise DatasetError(f'row {rownum}: slot end must be after start')
        if int(result['duration_min']) > int((e-s).total_seconds()//60):
            raise DatasetError(f'row {rownum}: duration_min exceeds slot length')
    if result.get('accessibility_required'):
        result['accessibility_required']=parse_flag(result['accessibility_required'],f'row {rownum}, accessibility_required')
    if result.get('accessible'):
        result['accessible']=parse_flag(result['accessible'],f'row {rownum}, accessible')
    return result


def load_csv(path, kind):
    path=Path(path)
    with path.open(newline='',encoding='utf-8-sig') as f:
        reader=csv.DictReader(f)
        if not reader.fieldnames: raise DatasetError(f'{path.name}: no header row')
        records=[_normalize(row,kind,n) for n,row in enumerate(reader,2)]
    if not records: raise DatasetError(f'{path.name}: dataset is empty')
    idcol='patient_id' if kind=='patient' else 'slot_id'
    ids=[r[idcol] for r in records]
    if len(set(ids))!=len(ids): raise DatasetError(f'{path.name}: duplicate {idcol}')
    return records


def validate_pair(patients, slots):
    """Checks structural integrity without guessing clinical compatibility."""
    if not patients or not slots: raise DatasetError('Patient and slot collections must be nonempty')
    reversed_availability=[p['patient_id'] for p in patients if p['available_start'] >= p['available_end']]
    return {'patients':len(patients),'slots':len(slots),
            'warnings': {'invalid_availability_windows': reversed_availability},
            'services':sorted(set(p['service_type'] for p in patients)),
            'slot_services':sorted(set(s['service_type'] for s in slots))}
