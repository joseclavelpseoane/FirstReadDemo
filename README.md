# football-pbp-stats

Derives American football statistics from a play-by-play log. Pure functions, zero dependencies,
33 tests.

This is the derivation engine extracted from **FirstRead**, a stats platform I built for the
coaching staff of an amateur club in Spain. The product is private; this module is the part worth
reading.

```bash
npm test     # node --test, no framework
```

---

## The premise

There is no `stats` table anywhere in FirstRead. Not passing yards, not third-down rate, not even
the score. The play-by-play log is the only thing stored, and every number is computed from it on
read — by this module, which is the single definition of how a play becomes a number.

That constraint is the whole design. A stored statistic is a second source of truth, and second
sources of truth drift: a coach corrects a misattributed tackle three days after the game, and now
the box score, the season averages and the player's page disagree with the play log and with each
other. Derive instead, and the correction propagates for free.

The cost is that the derivation has to be right, which is what the tests are for.

## What it computes

| Function | What it gives you |
|---|---|
| `scoringSide(play)` | which side a play's points go to |
| `sideStats(plays, drives, side, results)` | yards, YPP, explosives, first downs, third-down conversion, red-zone trips, turnovers |
| `playerStats(plays)` | full box score: rushing, passing, receiving, defense, kicking, returns |
| `downSplit(plays, side)` | run/pass tendency and success rate for one down |
| `downDistanceGrid(plays, side)` | the down × distance matrix (short 1-3 / medium 4-7 / long 8+) |
| `buildDriveResults(plays)` | how each drive ended |
| `filterPlays(plays, filter)` | situational subset — a quarter, a half, a down |
| `parseSpot` / `advance` / `inRedZone` | field position in absolute 0–100 yards |

Everything takes plain objects. No database, no framework, no I/O.

```js
import { sideStats, buildDriveResults } from "football-pbp-stats";

const results = buildDriveResults(plays);
const us = sideStats(plays, drives, "us", results);
// { plays: 61, yards: 315, ypp: 5.16, thirdConv: 7, thirdAtt: 13, redTrips: 3, redTD: 2, ... }
```

## Decisions worth explaining

**A safety scores for the defense, so the scoring side can't be read off possession.**
Every other play awards points to whoever has the ball. `scoringSide` exists because that one
exception can't be derived from `has_offense` / `has_defense` alone — and getting it wrong puts
the entire game's scoreboard two points out.

**Penalty yardage is deliberately excluded from `yards_gained`.**
A running back who gains 7 on a play wiped out by a holding call still gained 7 — his average
shouldn't absorb someone else's penalty. But the ball genuinely moved backwards, so field position
has to walk the *net*. Two different numbers for two different questions: `yards_gained` for
people, `netYards()` for the ball.

**A sack is a pass play.**
Standard charting convention: it's a dropback, so it belongs to the pass tendency, not the run
tendency. It consumes a down and produces negative yardage, but calling it a run would make every
run/pass split lie about what was called.

**Success rate is down-dependent.**
40% of the distance on first down, 60% on second, and on third or fourth the only success is the
conversion. Gaining 9 on 3rd-and-10 is not 90% of a success — it's a punt.

**Kickoffs are not drives.**
They live in the same table as drives and also carry a possession side, so anything that walks
drives has to filter them out explicitly. Without that filter a kickoff starting on the opponent's
15 registers as a red-zone trip, and red-zone efficiency quietly inflates. The filter lives inside
`sideStats` rather than at the call sites, so the trap can't be re-armed by the next caller.

**A touchdown counts as a red-zone trip even when the drive is under-recorded.**
Defensive series get logged less completely than offensive ones. A touchdown passed through the
red zone by definition, so it's counted as a trip even if the logged plays don't add up to one —
otherwise a touchdown drive reports 0/0 red-zone efficiency.

**Coverage tackles are counted separately from defensive tackles.**
Special teams is a different unit. Merging them inflates the tackle count of every linebacker who
also covers kicks.

**Punt return yardage is credited to the punter, not a returner.**
On a punt the returner belongs to the other team, and this is a single-sided system — only your
own players are recorded. The yardage is stored against the punter so net punting works: gross
measures the leg, net measures the field position actually gained, which is the reason you punt.

**Longest field goal counts makes only.**
A missed 55-yarder is not a range record.

## Tests

33 tests, `node:test`, no framework and no fixtures. They're written to document the decisions
above — each one names the failure it prevents rather than the function it calls.

```
npm test
# tests 33 | pass 33 | fail 0
```

## Shape of the data

Plays are plain objects. Only the fields a given function reads need to be present:

```js
{
  sequence: 12, quarter: "Q2", down: 3, yards_to_go: 7, yards_gained: 11,
  has_offense: true, has_defense: false, has_special: false,
  label: "PASE", outcome: null, drive_id: 4,
  offense: {
    executor_roster_id: 1,  executor_snapshot: { name: "...", jersey: 7 },
    receiver_roster_id: 2,  receiver_snapshot: { name: "...", jersey: 80 },
    penalty_yards: 0,
  },
}
```

`*_snapshot` is a frozen copy of who that player was at the moment of the play, stored alongside a
stable roster id. It's what keeps a box score from last season correct after a player changes
jersey number — history is a record, not a view.

Source comments are in Spanish, like the product and the people it was built for.

---

© 2026 Jose Clavel. All rights reserved. Public so it can be read; not licensed for reuse.
