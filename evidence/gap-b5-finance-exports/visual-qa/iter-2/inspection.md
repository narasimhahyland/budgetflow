# Iteration 2 inspection (094b)

| Screen | State               | Viewport | Severity             | Finding                                                                                                                                                                                              |
| ------ | ------------------- | -------- | -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 094b   | default, new-export | desktop  | blocking (automated) | layout shift 0.291 remains (traced with a PerformanceObserver: `.bf-page__actions` moved from the heading row to a new row). Fix: the period and New export toolbar is its own row under the header. |
