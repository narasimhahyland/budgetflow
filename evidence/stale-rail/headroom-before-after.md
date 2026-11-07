# Headroom before and after the rail re-record

`npm run visual:headroom`, same command, same stack, same deterministic seed.

|                                             | before | after   |
| ------------------------------------------- | ------ | ------- |
| states matching their baseline exactly      | 340    | **540** |
| states that differ at all                   | 289    | **88**  |
| states using 70% or more of their allowance | 45     | **36**  |

200 states stopped differing. That is the rail drift leaving every screen's allowance, which is
what stops a single unrelated change tipping a random state over the line.

The 36 that remain are named in `headroom-after.md`; the 38 stale-rail baselines held back
because they also drift behind the rail are in `remaining.txt` with their numbers.
