#!/usr/bin/env python3
"""Builds src/pincodes.json from the India Post "All India Pincode Directory" (data.gov.in, Government Open Data License – India),
as mirrored in github.com/dropdevrahul/pincodes-india (pincode.csv).
Output: one entry per 6-digit PIN → district(s) + GST state code. A PIN whose post offices lie in more than one district or state
keeps every candidate with its post-office count, so the app can ask instead of guessing.
  python3 tools/build-pincodes.py <pincode.csv> src/pincodes.json
"""
import csv, json, sys, collections, re

STATE = {'ANDAMAN AND NICOBAR ISLANDS': '35', 'ANDHRA PRADESH': '37', 'ARUNACHAL PRADESH': '12', 'ASSAM': '18', 'BIHAR': '10', 'CHANDIGARH': '04',
  'CHHATTISGARH': '22', 'DELHI': '07', 'GOA': '30', 'GUJARAT': '24', 'HARYANA': '06', 'HIMACHAL PRADESH': '02', 'JAMMU AND KASHMIR': '01', 'JHARKHAND': '20',
  'KARNATAKA': '29', 'KERALA': '32', 'LADAKH': '38', 'LAKSHADWEEP': '31', 'MADHYA PRADESH': '23', 'MAHARASHTRA': '27', 'MANIPUR': '14', 'MEGHALAYA': '17',
  'MIZORAM': '15', 'NAGALAND': '13', 'ODISHA': '21', 'PUDUCHERRY': '34', 'PUNJAB': '03', 'RAJASTHAN': '08', 'SIKKIM': '11', 'TAMIL NADU': '33', 'TELANGANA': '36',
  'THE DADRA AND NAGAR HAVELI AND DAMAN AND DIU': '26', 'TRIPURA': '16', 'UTTAR PRADESH': '09', 'UTTARAKHAND': '05', 'WEST BENGAL': '19'}

def title(s):
    s = re.sub(r'\s+', ' ', s.strip()).title()
    return re.sub(r"\b(And|Of)\b", lambda m: m.group(1).lower(), s)

src, out = sys.argv[1], sys.argv[2]
pins = collections.defaultdict(collections.Counter)
for r in csv.DictReader(open(src, encoding='utf-8', errors='replace')):
    p, st = r['Pincode'].strip(), r['StateName'].strip().upper()
    # civilian PINs start with 1–8 (9 = Army Postal Service); India Post's own "TEST OFFICE" rows are left out
    if len(p) != 6 or not p.isdigit() or p[0] in '09' or 'TEST OFFICE' in r['OfficeName'].upper(): continue
    if st not in STATE: raise SystemExit('unknown state ' + st)
    pins[p][(title(r['District']), STATE[st])] += 1
dists = sorted({k for c in pins.values() for k in c})
idx = {k: i for i, k in enumerate(dists)}
flat, amb, last = [], {}, 0
for p in sorted(pins, key=int):
    c = pins[p]
    if len(c) == 1:
        (k, _), = c.items(); flat += [int(p) - last, idx[k]]; last = int(p)
    else:
        amb[p] = [[idx[k], n] for k, n in c.most_common()]
data = {'source': 'India Post — All India Pincode Directory (data.gov.in, GODL-India), via github.com/dropdevrahul/pincodes-india (2024-06)',
        'count': len(pins), 'D': [[n, s] for n, s in dists], 'P': flat, 'A': amb}
json.dump(data, open(out, 'w'), separators=(',', ':'))
print(len(pins), 'PINs,', len(dists), 'districts,', len(amb), 'with more than one district/state')
