# Pace Engine — Formula Reference

## Segment Travel Time

For each sample-to-sample segment:

```
distKm    = (distances[i] - distances[i-1]) / 1000
ascM      = max(0, elevations[i] - elevations[i-1])
descM     = max(0, -(elevations[i] - elevations[i-1]))

fm (fatigue multiplier):
  if fatH ≤ 2.0:  fm = 1.0
  else:           fm = max(0.6, exp(-0.06 × (fatH - 2.0)))

segH = distKm / max(0.01, baseSpeed × fm)
     + ascM  / max(1, ascentRate  × fm)   [if ascentMH > 0]
     + descM / max(1, descentRate × fm)   [if descentMH > 0]
```

## Load Penalty

```
loadRatio   = packWeightKg / max(1, bodyWeightKg)
loadPenalty = max(0.5, 1.0 - loadRatio × 1.1)

baseSpeed   = flatPaceKmH ?? (activity.speedKmH × loadPenalty)
ascentRate  = activity.ascentMH  × loadPenalty
descentRate = activity.descentMH × loadPenalty
```

A 30 kg pack on a 70 kg person: loadRatio ≈ 0.43 → loadPenalty ≈ max(0.5, 0.53) ≈ 0.53

## Rest Breaks (in-segment)

Within `computeCumulativeTimes` / `computeSegmentTimesFromState`:

```
if movingH + rem >= nextRestH:
    advance to rest point, add restH elapsed, reduce fatH:
    fatH = max(0, fatH - restMinutes / 20)   // 1 min rest = 3 min fatigue recovery
    nextRestH += restEveryH
```

## Waypoint Recovery (at waypoint boundary)

```
newFatH = max(0, state.fatH - restH × 3)
nextRestH = state.movingH + restEveryH   // reset break interval
```

The ×3 ratio is consistent with the in-segment model (restMinutes/20 h = restMinutes×3/60 h recovery per restMinutes/60 h rest).

## Calorie Model (computeTripStats)

```
kcalMoving = baseMET × bodyWeightKg × movingH × fm   (accumulated per segment)
kcalRest   = REST_MET (1.5) × bodyWeightKg × restH
kcalSuggested = 250 × movingH   (carb/fuel intake target)
```

## 上河速度

```
SHANHE_BASE = 3.0 km/h   (standard group, flat terrain, S = 1.0)

V_km_h = SHANHE_BASE / S
S       = SHANHE_BASE / V_km_h

S = 0.8  → V = 3.75 km/h  (faster than standard)
S = 1.0  → V = 3.00 km/h  (standard)
S = 1.5  → V = 2.00 km/h  (slower than standard)
```

Standard group assumption: 5 people, heavy packs (≈15–20 kg), moderate trail.
Source: 台灣山岳 / 台灣登山研究 convention.
