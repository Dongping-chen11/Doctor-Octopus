"""Command-line check and preview for a pair of synthetic CSV files.

Usage: python check_dataset.py data/patients.csv data/slots.csv
       python check_dataset.py my_patients.csv my_slots.csv --export normalized
"""
import argparse
import csv
import json
from pathlib import Path
from data_adapter import DatasetError, load_csv, validate_pair
from engine import match


def run():
    parser=argparse.ArgumentParser(description='Validate and preview a synthetic AIDE dataset')
    parser.add_argument('patients',type=Path)
    parser.add_argument('slots',type=Path)
    parser.add_argument('--export',type=Path,help='Directory to write normalized CSV files')
    args=parser.parse_args()
    try:
        people=load_csv(args.patients,'patient')
        slots=load_csv(args.slots,'slot')
        summary=validate_pair(people,slots)
        print('DATA VALIDATION PASSED')
        print(json.dumps(summary,indent=2))
        for slot in slots[:5]:
            outcome=match(slot,people)
            print(f"{slot['slot_id']}: eligible={len(outcome['eligible'])}, excluded={len(outcome['excluded'])}; top={','.join(p['patient_id'] for p in outcome['eligible'][:3]) or 'none'}")
        if args.export:
            args.export.mkdir(parents=True,exist_ok=True)
            for name,rows in (('patients.csv',people),('slots.csv',slots)):
                keys=list(dict.fromkeys(k for row in rows for k in row))
                with (args.export/name).open('w',newline='',encoding='utf-8') as f:
                    writer=csv.DictWriter(f,fieldnames=keys,extrasaction='ignore')
                    writer.writeheader();writer.writerows(rows)
            print(f'Normalized CSV files written to {args.export}')
    except (DatasetError,ValueError,OSError) as exc:
        parser.exit(2,f'DATA VALIDATION FAILED: {exc}\n')

if __name__=='__main__':run()
