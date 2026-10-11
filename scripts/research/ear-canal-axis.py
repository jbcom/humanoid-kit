"""The ear canal's path for src/affordance/channel.ts (docs/research/AFFORDANCE-CHANNELS.md).

Reads two open files of Voss et al. 2025 (Trends in Hearing, doi 10.1177/23312165251345572,
PMC12198549, CC BY-NC):

- Figure 6 (`fig6.jpg`, the article's figure 6 image): every ear's central axis, projected
  on the sagittal and transverse planes, by age group. The seven adult panels (20 to 90
  years) are digitised: their red and blue axis points mapped through each panel's axes,
  left and right ears folded together, and the median height (and front-back place) taken
  at each millimetre out from the tympanic annulus, then averaged over the panels.
- The per-ear table (`sj-csv-2-tia-10.1177_23312165251345572.csv`, its supplement): canal
  length, annulus to first bend, the bone-to-cartilage transition (`MaxB2C`, where the canal
  becomes all cartilage: the second bend) and the area at each millimetre, for the 140
  ears of adults aged 20 or over.

The path's shape is the median axis's three straight runs (annulus to its sagittal peak,
peak to trough, trough to entrance), walked out from the annulus at the table's mean
distances, so the two bends sit where the table puts them, turned by the angles the median
axis turns. Prints the knots in the head's frame from the entrance (metres: forward, up,
toward the midline) with each one's size as a share of the entrance's.

    uv run --with pillow --with numpy python -I scripts/research/ear-canal-axis.py <fig6.jpg> <table.csv>
"""

import csv
import statistics
import sys

import numpy as np
from PIL import Image

figure, table = sys.argv[1], sys.argv[2]

# The figure's panels: each column's x axis spans -40..40 mm between these pixel columns;
# each row's sagittal plot spans +10..-10 mm and transverse +5..-20 mm between these rows
# (the axis lines, found by their long grey runs).
COLUMNS = [(31, 168), (212, 363), (407, 557), (601, 752)]
ROWS = [((37, 147), (171, 282)), ((330, 441), (464, 575)), ((623, 734), (758, 868))]
ADULT_PANELS = [(1, 1), (1, 2), (1, 3), (2, 0), (2, 1), (2, 2), (2, 3)]

im = np.array(Image.open(figure).convert("RGB")).astype(int)
R, G, B = im[:, :, 0], im[:, :, 1], im[:, :, 2]
red = (R > 170) & (R - G > 60) & (R - B > 60)
blue = (B > 140) & (B - R > 60) & (B - G > 30)


def points(row, col, plane):
    x0, x1 = COLUMNS[col]
    (st, sb), (tt, tb) = ROWS[row]
    top, bottom, hi, lo = (st, sb, 10, -10) if plane == "sagittal" else (tt, tb, 5, -20)
    out = []
    for mask, side in ((red, -1), (blue, 1)):
        ys, xs = np.nonzero(mask[top - 2 : bottom + 3, x0 + 2 : x1 + 1])
        for py, px in zip(ys + top - 2, xs + x0 + 2):
            x = -40 + 80 * (px - x0) / (x1 - x0)
            if x * side > 0:
                out.append((abs(x), hi - (hi - lo) * (py - top) / (bottom - top)))
    return np.array(out)


out_mm = np.arange(0, 32, 1.0)
median = {}
for plane in ("sagittal", "transverse"):
    panels = []
    for row, col in ADULT_PANELS:
        p = points(row, col, plane)
        panels.append(
            [
                np.median(s[:, 1]) if len(s := p[(p[:, 0] >= b - 0.75) & (p[:, 0] < b + 0.75)]) >= 4 else np.nan
                for b in out_mm
            ]
        )
    median[plane] = np.nanmean(np.array(panels), axis=0)
up, back = median["sagittal"], median["transverse"]
up[0] = back[0] = 0.0
smooth = lambda v: np.concatenate([[v[0]], (v[:-2] + v[1:-1] + v[2:]) / 3, [v[-1]]])
up, back = smooth(up), smooth(back)
axis = np.stack([out_mm, up, back], axis=1)  # lateral, superior, the figure's anterior-to-posterior
print("median adult axis (mm): lateral, superior, anterior-to-posterior")
for p in axis:
    print("  %5.1f %6.2f %6.2f" % tuple(p))

rows = [r for r in csv.DictReader(open(table)) if float(r["Age"]) >= 20]


def mean(key, f=float):
    v = [f(r[key]) for r in rows if r[key] not in ("", "NaN", "nan")]
    v = [x for x in v if x == x]
    return statistics.mean(v), statistics.stdev(v), len(v)


length, first, second = mean("Length")[0], mean("FirstBendDistance")[0], mean("MaxB2C")[0]
print("adult ears: %d; length %.1f, annulus to first bend %.1f, to second bend %.1f mm" % (len(rows), length, first, second))

peak = axis[6 + int(np.argmax(up[6:16]))]
trough = axis[16 + int(np.argmin(up[16:27]))]
unit = lambda v: v / np.linalg.norm(v)
runs = [unit(peak - axis[0]), unit(trough - peak), unit(axis[-1] - trough)]
turn = lambda a, b: np.degrees(np.arccos(np.clip(np.dot(a, b), -1, 1)))
print("second bend turns %.1f deg, first bend %.1f deg" % (turn(runs[0], runs[1]), turn(runs[1], runs[2])))

annulus = np.zeros(3)
isthmus = annulus + runs[0] * 4.0
second_bend = annulus + runs[0] * second
first_bend = second_bend + runs[1] * (first - second)
entrance = first_bend + runs[2] * (length - first)


def area_at(mm):
    key = "Position%02d" % round(mm)
    v = [float(r[key]) for r in rows if r.get(key) not in (None, "", "NaN", "nan")]
    return statistics.mean(v)


entrance_area = []
for r in rows:
    if r["Length"] in ("", "NaN"):
        continue
    L = float(r["Length"])
    measured = [(int(k[8:]), float(v)) for k, v in r.items() if k.startswith("Position") and v not in ("", "NaN", "nan")]
    lateral = [(p, a) for p, a in measured if p <= L + 0.5]
    if lateral and L - max(lateral)[0] <= 1.5:
        entrance_area.append(max(lateral)[1])
areas = {
    "entrance": statistics.mean(entrance_area),
    "first bend": mean("FirstBendArea")[0],
    "second bend": statistics.mean(
        [
            float(r["Position%02d" % round(float(r["MaxB2C"]))])
            for r in rows
            if r.get("Position%02d" % round(float(r["MaxB2C"]))) not in (None, "", "NaN", "nan")
        ]
    ),
    "isthmus": area_at(4),
    "annulus": area_at(0),
}
place = {"entrance": entrance, "first bend": first_bend, "second bend": second_bend, "isthmus": isthmus, "annulus": annulus}
print("knots from the entrance, head frame (m): forward, up, toward the midline; share of the entrance's size")
for name in ("entrance", "first bend", "second bend", "isthmus", "annulus"):
    r = place[name] - entrance
    # The figure's transverse axis runs anterior to posterior: forward is its negative.
    print(
        "  %-12s [%.5f, %.5f, %.5f]  area %.1f mm2, share %.4f"
        % (name, -r[2] / 1000, r[1] / 1000, -r[0] / 1000, areas[name], (areas[name] / areas["entrance"]) ** 0.5)
    )
