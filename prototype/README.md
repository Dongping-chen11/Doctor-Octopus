# Doctor Octopus v0.9 — larger synthetic pool and expiring offer waves

Fully fictional, local-only prototype. **Not a clinical or production booking system.**

## Windows
1. Extract ZIP and open Terminal in `doctor_octopus_v09`.
2. Run `python server.py`.
3. Visit http://127.0.0.1:8000/clinic/ and http://127.0.0.1:8000/patient/.
4. In Clinic → Schedule, choose S001 and cancel; Clinic → Appointment Recovery shows ranked eligible patients. Send next 3 simulated offers.
5. In Patient → My Offers, choose an offered fictional patient and accept or decline. If all three decline, the system automatically sends to the next three. Alternatively use **Advance demo clock 20 min** on Recovery to expire offers and trigger the next wave. Accepting creates a hold; confirm it in Clinic → Approvals.
6. Run tests: `python -m unittest discover -s tests -v`. A fresh SQLite database seeds itself on first startup.

## What changed
- Two fictional clinics with **250 synthetic patients each (500 total)**, up from 50 each. 80 interactive scheduled appointments retained.
- Extra 400 patients have fictional names, active service-specific requests, explicit date availability, travel estimates and practitioner preferences. These data intentionally create fuller test pools; they are NOT derived patient-by-patient from Rosemi exports.
- Rules-only matching score reflects *stated fit and priority*, **not an acceptance probability**. Higher values come from more realistic explicitly compatible fictional test cases, not changing the scoring formula.
- Offers carry `sent_at`, `expires_at`, `wave`; each wave has up to 3 people and a maximum 20-minute response time. Deadline is shortened to preserve travel and 5-minute approval buffer. Expiry or all declines triggers the next wave if feasible. Backend rejects late responses.
- Each opening has a deterministic **simulated clock**, initialized from its fictional `released_at`. The clinic can advance it by 20 min to demonstrate expiry, because demo appointments have fixed historical dates. This is NOT a wall-clock timer.
- Experimental ML comparison remains separate from the live rules-based engine; no real acceptance labels exist, and an ML model is not a validated probability for real patients.

## Caveats
- More patients do not guarantee matches for every slot: service, visit type, availability, travel, consent and restrictions are strict.
- Timers run when the simulated clock is advanced; real automatic time passage is not implemented. There is no real SMS.
- SQLite persists demo state between restarts; reset from `/demo/` to rerun. The persona selector is not authentication.
- This is a synthetic demonstrator. No real names/identifiers or raw appointment exports are embedded.


## v0.9.1 — demo patient navigation fix

- The selected fictional patient account is saved in the browser's local storage and URL. When the clinic confirms an appointment or you navigate between patient pages, you will stay on the selected fictional account rather than returning to Maya Patel.
- The Patient Portal includes a search field for patient name or internal ID. Start typing to narrow the account selector, or press Enter to select the first matching name.
- For an existing v0.9 installation, launch this v0.9.1 folder separately. It includes the same synthetic dataset, rules-based ranking and timed-wave functionality.
- This is not authentication: all fictional personas are selectable for demonstration.
