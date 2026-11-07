# Visual baseline headroom

Allowance: 0.002 of each image's pixels. Measured by comparing every state
with no allowance at all, so these are the differences the gate is currently tolerating.

259 state(s) match their baseline exactly. 233 differ.

> Taken on this machine with a second Playwright process running against the same worktree, which
> deletes the shared artifacts directory mid-run. 137 states therefore carry no reading, and
> `026-reduce-budget dialog › desktop` reads over the allowance because that run inherited state
> from an earlier pass, not because its baseline has drifted. The readings below the 100% line are
> the useful part: they are measured against the committed baselines from a deterministic seed.

## Using 70% or more of the allowance (41)

| State                                                       | Pixels | Allowance | Used  |                                               |
| ----------------------------------------------------------- | ------ | --------- | ----- | --------------------------------------------- |
| 026-reduce-budget dialog › desktop                          | 26647  | 2592      | 1028% | over the allowance, the gate fails this state |
| 015b-participation-reach default › mobile                   | 742    | 754       | 98%   | inside the allowance                          |
| 082-utilization-report default › mobile                     | 728    | 754       | 97%   | inside the allowance                          |
| 082-utilization-report drilldown › mobile                   | 728    | 754       | 97%   | inside the allowance                          |
| 061d-chat-balance-request-alerts app-home › desktop         | 2502   | 2592      | 97%   | inside the allowance                          |
| 015a-spend-per-head default › mobile                        | 722    | 754       | 96%   | inside the allowance                          |
| 059b-mobile-balance-receipts receipt › desktop              | 2467   | 2592      | 95%   | inside the allowance                          |
| 080e-period-close-checklist acknowledge-dialog › mobile     | 714    | 754       | 95%   | inside the allowance                          |
| 101-webhooks add-endpoint › desktop                         | 2367   | 2592      | 91%   | inside the allowance                          |
| 090-approval-history default › desktop                      | 2366   | 2592      | 91%   | inside the allowance                          |
| 000a-app-shell notifications-open › desktop                 | 2354   | 2592      | 91%   | inside the allowance                          |
| 080-budget-vs-actual default › desktop                      | 2332   | 2592      | 90%   | inside the allowance                          |
| 015b-participation-reach default › desktop                  | 2291   | 2592      | 88%   | inside the allowance                          |
| 085-event-spending default › desktop                        | 2261   | 2592      | 87%   | inside the allowance                          |
| 084-department-comparison default › desktop                 | 2228   | 2592      | 86%   | inside the allowance                          |
| 080-budget-vs-actual default › mobile                       | 645    | 754       | 86%   | inside the allowance                          |
| 085-event-spending default › mobile                         | 634    | 754       | 84%   | inside the allowance                          |
| 059-approval-inbox default › desktop                        | 2122   | 2592      | 82%   | inside the allowance                          |
| 061-approval-decision approve-part › desktop                | 2105   | 2592      | 81%   | inside the allowance                          |
| 019-budget-list default › desktop                           | 2063   | 2592      | 80%   | inside the allowance                          |
| 011a-ai-assistant-panel action-redirect › desktop           | 2057   | 2592      | 79%   | inside the allowance                          |
| 081-allocation-report default › desktop                     | 1996   | 2592      | 77%   | inside the allowance                          |
| 011a-ai-assistant-panel refused-out-of-scope › desktop      | 1972   | 2592      | 76%   | inside the allowance                          |
| 023-budget-hierarchy set-to-zero-dialog › desktop           | 1971   | 2592      | 76%   | inside the allowance                          |
| 000a-app-shell placeholder › tablet                         | 1387   | 1855      | 75%   | inside the allowance                          |
| 056a-inter-director-contribution-request giver › desktop    | 1922   | 2592      | 74%   | inside the allowance                          |
| 084-department-comparison default › mobile                  | 550    | 754       | 73%   | inside the allowance                          |
| 083-location-comparison default › mobile                    | 548    | 754       | 73%   | inside the allowance                          |
| 113a-ai-settings-query-log features › tablet                | 1321   | 1855      | 71%   | inside the allowance                          |
| 060-request-details requester › tablet                      | 1320   | 1855      | 71%   | inside the allowance                          |
| 079-report-catalog scoped-owner › desktop                   | 1843   | 2592      | 71%   | inside the allowance                          |
| 011a-ai-assistant-panel default › desktop                   | 1843   | 2592      | 71%   | inside the allowance                          |
| 011a-ai-assistant-panel answer › desktop                    | 1843   | 2592      | 71%   | inside the allowance                          |
| 020-create-budget default › desktop                         | 1832   | 2592      | 71%   | inside the allowance                          |
| 065-rejected-request-resubmission counter-offer › tablet    | 1305   | 1855      | 70%   | inside the allowance                          |
| 113a-ai-settings-query-log turn-on-dialog › tablet          | 1304   | 1855      | 70%   | inside the allowance                          |
| 056a-inter-director-contribution-request organizer › tablet | 1303   | 1855      | 70%   | inside the allowance                          |
| 020b-program-templates default › desktop                    | 1819   | 2592      | 70%   | inside the allowance                          |
| 020a-budget-plan-import map-columns › desktop               | 1818   | 2592      | 70%   | inside the allowance                          |
| 020a-budget-plan-import review › desktop                    | 1818   | 2592      | 70%   | inside the allowance                          |
| 088-audit-log default › desktop                             | 1816   | 2592      | 70%   | inside the allowance                          |

## Every state that differs (233)

| State                                                        | Pixels | Allowance | Used  |                                               |
| ------------------------------------------------------------ | ------ | --------- | ----- | --------------------------------------------- |
| 026-reduce-budget dialog › desktop                           | 26647  | 2592      | 1028% | over the allowance, the gate fails this state |
| 015b-participation-reach default › mobile                    | 742    | 754       | 98%   | inside the allowance                          |
| 082-utilization-report default › mobile                      | 728    | 754       | 97%   | inside the allowance                          |
| 082-utilization-report drilldown › mobile                    | 728    | 754       | 97%   | inside the allowance                          |
| 061d-chat-balance-request-alerts app-home › desktop          | 2502   | 2592      | 97%   | inside the allowance                          |
| 015a-spend-per-head default › mobile                         | 722    | 754       | 96%   | inside the allowance                          |
| 059b-mobile-balance-receipts receipt › desktop               | 2467   | 2592      | 95%   | inside the allowance                          |
| 080e-period-close-checklist acknowledge-dialog › mobile      | 714    | 754       | 95%   | inside the allowance                          |
| 101-webhooks add-endpoint › desktop                          | 2367   | 2592      | 91%   | inside the allowance                          |
| 090-approval-history default › desktop                       | 2366   | 2592      | 91%   | inside the allowance                          |
| 000a-app-shell notifications-open › desktop                  | 2354   | 2592      | 91%   | inside the allowance                          |
| 080-budget-vs-actual default › desktop                       | 2332   | 2592      | 90%   | inside the allowance                          |
| 015b-participation-reach default › desktop                   | 2291   | 2592      | 88%   | inside the allowance                          |
| 085-event-spending default › desktop                         | 2261   | 2592      | 87%   | inside the allowance                          |
| 084-department-comparison default › desktop                  | 2228   | 2592      | 86%   | inside the allowance                          |
| 080-budget-vs-actual default › mobile                        | 645    | 754       | 86%   | inside the allowance                          |
| 085-event-spending default › mobile                          | 634    | 754       | 84%   | inside the allowance                          |
| 059-approval-inbox default › desktop                         | 2122   | 2592      | 82%   | inside the allowance                          |
| 061-approval-decision approve-part › desktop                 | 2105   | 2592      | 81%   | inside the allowance                          |
| 019-budget-list default › desktop                            | 2063   | 2592      | 80%   | inside the allowance                          |
| 011a-ai-assistant-panel action-redirect › desktop            | 2057   | 2592      | 79%   | inside the allowance                          |
| 081-allocation-report default › desktop                      | 1996   | 2592      | 77%   | inside the allowance                          |
| 011a-ai-assistant-panel refused-out-of-scope › desktop       | 1972   | 2592      | 76%   | inside the allowance                          |
| 023-budget-hierarchy set-to-zero-dialog › desktop            | 1971   | 2592      | 76%   | inside the allowance                          |
| 000a-app-shell placeholder › tablet                          | 1387   | 1855      | 75%   | inside the allowance                          |
| 056a-inter-director-contribution-request giver › desktop     | 1922   | 2592      | 74%   | inside the allowance                          |
| 084-department-comparison default › mobile                   | 550    | 754       | 73%   | inside the allowance                          |
| 083-location-comparison default › mobile                     | 548    | 754       | 73%   | inside the allowance                          |
| 113a-ai-settings-query-log features › tablet                 | 1321   | 1855      | 71%   | inside the allowance                          |
| 060-request-details requester › tablet                       | 1320   | 1855      | 71%   | inside the allowance                          |
| 079-report-catalog scoped-owner › desktop                    | 1843   | 2592      | 71%   | inside the allowance                          |
| 011a-ai-assistant-panel default › desktop                    | 1843   | 2592      | 71%   | inside the allowance                          |
| 011a-ai-assistant-panel answer › desktop                     | 1843   | 2592      | 71%   | inside the allowance                          |
| 020-create-budget default › desktop                          | 1832   | 2592      | 71%   | inside the allowance                          |
| 065-rejected-request-resubmission counter-offer › tablet     | 1305   | 1855      | 70%   | inside the allowance                          |
| 113a-ai-settings-query-log turn-on-dialog › tablet           | 1304   | 1855      | 70%   | inside the allowance                          |
| 056a-inter-director-contribution-request organizer › tablet  | 1303   | 1855      | 70%   | inside the allowance                          |
| 020b-program-templates default › desktop                     | 1819   | 2592      | 70%   | inside the allowance                          |
| 020a-budget-plan-import map-columns › desktop                | 1818   | 2592      | 70%   | inside the allowance                          |
| 020a-budget-plan-import review › desktop                     | 1818   | 2592      | 70%   | inside the allowance                          |
| 088-audit-log default › desktop                              | 1816   | 2592      | 70%   | inside the allowance                          |
| 060-request-details approver › desktop                       | 1794   | 2592      | 69%   | inside the allowance                          |
| 064a-digest-templates default › desktop                      | 1785   | 2592      | 69%   | inside the allowance                          |
| 079-report-catalog default › desktop                         | 1785   | 2592      | 69%   | inside the allowance                          |
| 091-scheduled-exports default › desktop                      | 1785   | 2592      | 69%   | inside the allowance                          |
| 016a-board-pack default › desktop                            | 1785   | 2592      | 69%   | inside the allowance                          |
| 016a-board-pack draft › desktop                              | 1785   | 2592      | 69%   | inside the allowance                          |
| 099a-cross-source-duplicates default › desktop               | 1785   | 2592      | 69%   | inside the allowance                          |
| 016b-spending-outlook-nudges default › desktop               | 1785   | 2592      | 69%   | inside the allowance                          |
| 016b-spending-outlook-nudges budget-outlook › desktop        | 1785   | 2592      | 69%   | inside the allowance                          |
| 113a-ai-settings-query-log accuracy › desktop                | 1785   | 2592      | 69%   | inside the allowance                          |
| 121a-receipt-quote-extraction default › desktop              | 1785   | 2592      | 69%   | inside the allowance                          |
| 121a-receipt-quote-extraction check-fields › desktop         | 1785   | 2592      | 69%   | inside the allowance                          |
| 123-notifications-tasks tasks › desktop                      | 1783   | 2592      | 69%   | inside the allowance                          |
| 000a-app-shell account-menu-open › desktop                   | 1777   | 2592      | 69%   | inside the allowance                          |
| 021-budget-details default › desktop                         | 1777   | 2592      | 69%   | inside the allowance                          |
| 021-budget-details controls-drawer › desktop                 | 1777   | 2592      | 69%   | inside the allowance                          |
| 022a-per-head-driver-allocation default › desktop            | 1777   | 2592      | 69%   | inside the allowance                          |
| 030-budget-version-history default › desktop                 | 1777   | 2592      | 69%   | inside the allowance                          |
| 031-budget-comparison default › desktop                      | 1777   | 2592      | 69%   | inside the allowance                          |
| 032-budget-calendar default › desktop                        | 1777   | 2592      | 69%   | inside the allowance                          |
| 089-allocation-history default › desktop                     | 1777   | 2592      | 69%   | inside the allowance                          |
| 082-utilization-report drilldown › desktop                   | 1777   | 2592      | 69%   | inside the allowance                          |
| 059c-notification-channels-push default › desktop            | 1777   | 2592      | 69%   | inside the allowance                          |
| 060a-comments-mentions-follow following › desktop            | 1777   | 2592      | 69%   | inside the allowance                          |
| 123-notifications-tasks default › desktop                    | 1777   | 2592      | 69%   | inside the allowance                          |
| 016a-board-pack forbidden-owner › desktop                    | 1777   | 2592      | 69%   | inside the allowance                          |
| 061f-chat-ask-budgetflow default › desktop                   | 1777   | 2592      | 69%   | inside the allowance                          |
| 061f-chat-ask-budgetflow turned-off › desktop                | 1777   | 2592      | 69%   | inside the allowance                          |
| 022d-suggested-allocations default › desktop                 | 1777   | 2592      | 69%   | inside the allowance                          |
| 022d-suggested-allocations checked › desktop                 | 1777   | 2592      | 69%   | inside the allowance                          |
| 019-budget-list empty › desktop                              | 1776   | 2592      | 69%   | inside the allowance                          |
| 064-request-history pending › tablet                         | 1268   | 1855      | 68%   | inside the allowance                          |
| 060-request-details rejected › tablet                        | 1267   | 1855      | 68%   | inside the allowance                          |
| 013-budget-health default › desktop                          | 1768   | 2592      | 68%   | inside the allowance                          |
| 092-integrations-hub read-only › desktop                     | 1766   | 2592      | 68%   | inside the allowance                          |
| 113a-ai-settings-query-log query-log › desktop               | 1766   | 2592      | 68%   | inside the allowance                          |
| 045-create-event-budget default › tablet                     | 1251   | 1855      | 67%   | inside the allowance                          |
| 046-event-details default › tablet                           | 1251   | 1855      | 67%   | inside the allowance                          |
| 047-event-participants default › tablet                      | 1251   | 1855      | 67%   | inside the allowance                          |
| 049-cross-location-cost-split default › tablet               | 1251   | 1855      | 67%   | inside the allowance                          |
| 051-event-commitments default › tablet                       | 1251   | 1855      | 67%   | inside the allowance                          |
| 052-event-documents default › tablet                         | 1251   | 1855      | 67%   | inside the allowance                          |
| 046a-co-funding-board default › tablet                       | 1251   | 1855      | 67%   | inside the allowance                          |
| 057-additional-fund-request default › tablet                 | 1251   | 1855      | 67%   | inside the allowance                          |
| 064-request-history rejected › tablet                        | 1251   | 1855      | 67%   | inside the allowance                          |
| 118-request-event-funding default › tablet                   | 1251   | 1855      | 67%   | inside the allowance                          |
| 118-request-event-funding validation › tablet                | 1251   | 1855      | 67%   | inside the allowance                          |
| 121-upload-receipt default › tablet                          | 1251   | 1855      | 67%   | inside the allowance                          |
| 053a-intercompany-recharge-schedule default › desktop        | 1741   | 2592      | 67%   | inside the allowance                          |
| 087a-forecast-cycles owner-submission › desktop              | 1736   | 2592      | 67%   | inside the allowance                          |
| 087a-forecast-cycles commentary-required › desktop           | 1736   | 2592      | 67%   | inside the allowance                          |
| 024-allocate-to-child default › desktop                      | 1734   | 2592      | 67%   | inside the allowance                          |
| 024-allocate-to-child blocked › desktop                      | 1734   | 2592      | 67%   | inside the allowance                          |
| 025-transfer-budget dialog › desktop                         | 1734   | 2592      | 67%   | inside the allowance                          |
| 025-transfer-budget blocked › desktop                        | 1734   | 2592      | 67%   | inside the allowance                          |
| 026-reduce-budget below-floor › desktop                      | 1734   | 2592      | 67%   | inside the allowance                          |
| 027-freeze-budget dialog › desktop                           | 1734   | 2592      | 67%   | inside the allowance                          |
| 028-set-to-zero dialog › desktop                             | 1734   | 2592      | 67%   | inside the allowance                          |
| 028-set-to-zero validation › desktop                         | 1734   | 2592      | 67%   | inside the allowance                          |
| 029-revise-budget increase-request › desktop                 | 1734   | 2592      | 67%   | inside the allowance                          |
| 029a-contingency-reserve-release default › desktop           | 1717   | 2592      | 66%   | inside the allowance                          |
| 000a-app-shell default › desktop                             | 1706   | 2592      | 66%   | inside the allowance                          |
| 032a-period-phasing validation › desktop                     | 1643   | 2592      | 63%   | inside the allowance                          |
| 116-available-budgets default › tablet                       | 1168   | 1855      | 63%   | inside the allowance                          |
| 080f-transaction-matching-review default › desktop           | 1626   | 2592      | 63%   | inside the allowance                          |
| 080f-transaction-matching-review detail › desktop            | 1626   | 2592      | 63%   | inside the allowance                          |
| 080f-transaction-matching-review empty › desktop             | 1626   | 2592      | 63%   | inside the allowance                          |
| 017c-anomaly-flags default › desktop                         | 1560   | 2592      | 60%   | inside the allowance                          |
| 017c-anomaly-flags detail › desktop                          | 1560   | 2592      | 60%   | inside the allowance                          |
| 017c-anomaly-flags empty › desktop                           | 1560   | 2592      | 60%   | inside the allowance                          |
| 069a-policy-assistant default › tablet                       | 1105   | 1855      | 60%   | inside the allowance                          |
| 056-create-budget-request default › tablet                   | 1040   | 1855      | 56%   | inside the allowance                          |
| 058-over-budget-request default › tablet                     | 1040   | 1855      | 56%   | inside the allowance                          |
| 115-employee-dashboard default › tablet                      | 1040   | 1855      | 56%   | inside the allowance                          |
| 120-approved-allocations empty › tablet                      | 1040   | 1855      | 56%   | inside the allowance                          |
| 079-report-catalog forbidden › tablet                        | 1040   | 1855      | 56%   | inside the allowance                          |
| 087a-forecast-cycles forbidden › tablet                      | 1040   | 1855      | 56%   | inside the allowance                          |
| 092-integrations-hub forbidden › tablet                      | 1040   | 1855      | 56%   | inside the allowance                          |
| 000a-app-shell placeholder › desktop                         | 1387   | 2592      | 54%   | inside the allowance                          |
| 055-my-requests default › desktop                            | 1383   | 2592      | 53%   | inside the allowance                          |
| 069a-policy-assistant is-allowed › desktop                   | 1370   | 2592      | 53%   | inside the allowance                          |
| 113a-ai-settings-query-log features › desktop                | 1321   | 2592      | 51%   | inside the allowance                          |
| 060-request-details requester › desktop                      | 1320   | 2592      | 51%   | inside the allowance                          |
| 065-rejected-request-resubmission counter-offer › desktop    | 1305   | 2592      | 50%   | inside the allowance                          |
| 113a-ai-settings-query-log turn-on-dialog › desktop          | 1305   | 2592      | 50%   | inside the allowance                          |
| 056a-inter-director-contribution-request organizer › desktop | 1303   | 2592      | 50%   | inside the allowance                          |
| 000a-app-shell employee-forbidden › tablet                   | 932    | 1855      | 50%   | inside the allowance                          |
| 000a-app-shell employee-home › tablet                        | 932    | 1855      | 50%   | inside the allowance                          |
| 000a-app-shell not-found › tablet                            | 932    | 1855      | 50%   | inside the allowance                          |
| 120-approved-allocations default › desktop                   | 1279   | 2592      | 49%   | inside the allowance                          |
| 064-request-history pending › desktop                        | 1268   | 2592      | 49%   | inside the allowance                          |
| 060-request-details rejected › desktop                       | 1267   | 2592      | 49%   | inside the allowance                          |
| 045-create-event-budget default › desktop                    | 1251   | 2592      | 48%   | inside the allowance                          |
| 047-event-participants default › desktop                     | 1251   | 2592      | 48%   | inside the allowance                          |
| 051-event-commitments default › desktop                      | 1251   | 2592      | 48%   | inside the allowance                          |
| 052-event-documents default › desktop                        | 1251   | 2592      | 48%   | inside the allowance                          |
| 046a-co-funding-board default › desktop                      | 1251   | 2592      | 48%   | inside the allowance                          |
| 057-additional-fund-request default › desktop                | 1251   | 2592      | 48%   | inside the allowance                          |
| 064-request-history rejected › desktop                       | 1251   | 2592      | 48%   | inside the allowance                          |
| 118-request-event-funding default › desktop                  | 1251   | 2592      | 48%   | inside the allowance                          |
| 118-request-event-funding validation › desktop               | 1251   | 2592      | 48%   | inside the allowance                          |
| 121-upload-receipt default › desktop                         | 1251   | 2592      | 48%   | inside the allowance                          |
| 116-available-budgets default › desktop                      | 1168   | 2592      | 45%   | inside the allowance                          |
| 081-allocation-report default › mobile                       | 335    | 754       | 44%   | inside the allowance                          |
| 101-api-keys create-form › desktop                           | 1150   | 2592      | 44%   | inside the allowance                          |
| 022b-allocation-grid-paste paste-preview › mobile            | 333    | 754       | 44%   | inside the allowance                          |
| 023-budget-hierarchy set-to-zero-dialog › tablet             | 811    | 1855      | 44%   | inside the allowance                          |
| 069a-policy-assistant default › desktop                      | 1105   | 2592      | 43%   | inside the allowance                          |
| 023-budget-hierarchy default › mobile                        | 305    | 754       | 40%   | inside the allowance                          |
| 056-create-budget-request default › desktop                  | 1040   | 2592      | 40%   | inside the allowance                          |
| 058-over-budget-request default › desktop                    | 1040   | 2592      | 40%   | inside the allowance                          |
| 120-approved-allocations empty › desktop                     | 1040   | 2592      | 40%   | inside the allowance                          |
| 079-report-catalog forbidden › desktop                       | 1040   | 2592      | 40%   | inside the allowance                          |
| 087a-forecast-cycles forbidden › desktop                     | 1040   | 2592      | 40%   | inside the allowance                          |
| 092-integrations-hub forbidden › desktop                     | 1040   | 2592      | 40%   | inside the allowance                          |
| 027-freeze-budget dialog › tablet                            | 742    | 1855      | 40%   | inside the allowance                          |
| 101-api-keys create-form › tablet                            | 695    | 1855      | 37%   | inside the allowance                          |
| 000a-app-shell employee-forbidden › desktop                  | 932    | 2592      | 36%   | inside the allowance                          |
| 000a-app-shell employee-home › desktop                       | 932    | 2592      | 36%   | inside the allowance                          |
| 000a-app-shell not-found › desktop                           | 932    | 2592      | 36%   | inside the allowance                          |
| 069a-policy-assistant is-allowed › mobile                    | 265    | 754       | 35%   | inside the allowance                          |
| 092-integrations-hub default › tablet                        | 641    | 1855      | 35%   | inside the allowance                          |
| 092-integrations-hub connect-form › tablet                   | 641    | 1855      | 35%   | inside the allowance                          |
| 029-revise-budget increase-request › tablet                  | 638    | 1855      | 34%   | inside the allowance                          |
| 025-transfer-budget dialog › tablet                          | 630    | 1855      | 34%   | inside the allowance                          |
| 025-transfer-budget blocked › tablet                         | 630    | 1855      | 34%   | inside the allowance                          |
| 061e-chat-app-setup-linking default › mobile                 | 250    | 754       | 33%   | inside the allowance                          |
| 011a-ai-assistant-panel refused-out-of-scope › mobile        | 248    | 754       | 33%   | inside the allowance                          |
| 061e-chat-app-setup-linking default › desktop                | 759    | 2592      | 29%   | inside the allowance                          |
| 011a-ai-assistant-panel action-redirect › mobile             | 213    | 754       | 28%   | inside the allowance                          |
| 061e-chat-app-setup-linking default › tablet                 | 509    | 1855      | 27%   | inside the allowance                          |
| 092-connector-frame overview › tablet                        | 509    | 1855      | 27%   | inside the allowance                          |
| 092-connector-frame connection › tablet                      | 509    | 1855      | 27%   | inside the allowance                          |
| 092-connector-frame sync › tablet                            | 509    | 1855      | 27%   | inside the allowance                          |
| 092-connector-frame disconnect › tablet                      | 509    | 1855      | 27%   | inside the allowance                          |
| 093-hr-connector-mappings mappings › tablet                  | 509    | 1855      | 27%   | inside the allowance                          |
| 094a-adaptive-planning degraded › tablet                     | 509    | 1855      | 27%   | inside the allowance                          |
| 094a-adaptive-planning plan-import › tablet                  | 509    | 1855      | 27%   | inside the allowance                          |
| 096-card-connector settings › tablet                         | 509    | 1855      | 27%   | inside the allowance                          |
| 098-identity-sso-scim default › tablet                       | 509    | 1855      | 27%   | inside the allowance                          |
| 099-sync-status no-runs-yet › tablet                         | 509    | 1855      | 27%   | inside the allowance                          |
| 099b-pushes default › tablet                                 | 509    | 1855      | 27%   | inside the allowance                          |
| 099b-pushes card-limits › tablet                             | 509    | 1855      | 27%   | inside the allowance                          |
| 100-integration-errors nothing-failing › tablet              | 509    | 1855      | 27%   | inside the allowance                          |
| 101-api-keys default › tablet                                | 509    | 1855      | 27%   | inside the allowance                          |
| 101-webhooks default › tablet                                | 509    | 1855      | 27%   | inside the allowance                          |
| 101-webhooks add-endpoint › tablet                           | 509    | 1855      | 27%   | inside the allowance                          |
| 024-allocate-to-child default › tablet                       | 501    | 1855      | 27%   | inside the allowance                          |
| 024-allocate-to-child blocked › tablet                       | 501    | 1855      | 27%   | inside the allowance                          |
| 028-set-to-zero dialog › tablet                              | 493    | 1855      | 27%   | inside the allowance                          |
| 028-set-to-zero validation › tablet                          | 493    | 1855      | 27%   | inside the allowance                          |
| 092-integrations-hub default › desktop                       | 641    | 2592      | 25%   | inside the allowance                          |
| 092-integrations-hub connect-form › desktop                  | 641    | 2592      | 25%   | inside the allowance                          |
| 026-reduce-budget dialog › tablet                            | 387    | 1855      | 21%   | inside the allowance                          |
| 092-connector-frame overview › desktop                       | 509    | 2592      | 20%   | inside the allowance                          |
| 092-connector-frame connection › desktop                     | 509    | 2592      | 20%   | inside the allowance                          |
| 092-connector-frame sync › desktop                           | 509    | 2592      | 20%   | inside the allowance                          |
| 092-connector-frame disconnect › desktop                     | 509    | 2592      | 20%   | inside the allowance                          |
| 093-hr-connector-mappings mappings › desktop                 | 509    | 2592      | 20%   | inside the allowance                          |
| 094a-adaptive-planning degraded › desktop                    | 509    | 2592      | 20%   | inside the allowance                          |
| 094a-adaptive-planning plan-import › desktop                 | 509    | 2592      | 20%   | inside the allowance                          |
| 096-card-connector settings › desktop                        | 509    | 2592      | 20%   | inside the allowance                          |
| 098-identity-sso-scim default › desktop                      | 509    | 2592      | 20%   | inside the allowance                          |
| 099-sync-status no-runs-yet › desktop                        | 509    | 2592      | 20%   | inside the allowance                          |
| 099b-pushes default › desktop                                | 509    | 2592      | 20%   | inside the allowance                          |
| 099b-pushes card-limits › desktop                            | 509    | 2592      | 20%   | inside the allowance                          |
| 100-integration-errors nothing-failing › desktop             | 509    | 2592      | 20%   | inside the allowance                          |
| 101-api-keys default › desktop                               | 509    | 2592      | 20%   | inside the allowance                          |
| 101-webhooks default › desktop                               | 509    | 2592      | 20%   | inside the allowance                          |
| 086-unused-expired default › tablet                          | 348    | 1855      | 19%   | inside the allowance                          |
| 023-budget-hierarchy set-to-zero-dialog › mobile             | 137    | 754       | 18%   | inside the allowance                          |
| 090-approval-history default › tablet                        | 330    | 1855      | 18%   | inside the allowance                          |
| 026-reduce-budget below-floor › tablet                       | 263    | 1855      | 14%   | inside the allowance                          |
| 086-unused-expired default › mobile                          | 93     | 754       | 12%   | inside the allowance                          |
| 090-approval-history default › mobile                        | 89     | 754       | 12%   | inside the allowance                          |
| 061b-slack-approval-card default › mobile                    | 86     | 754       | 11%   | inside the allowance                          |
| 061c-teams-approval-card default › mobile                    | 86     | 754       | 11%   | inside the allowance                          |
| 011a-ai-assistant-panel action-redirect › tablet             | 180    | 1855      | 10%   | inside the allowance                          |
| 060-request-details requester › mobile                       | 69     | 754       | 9%    | inside the allowance                          |
| 011a-ai-assistant-panel refused-out-of-scope › tablet        | 163    | 1855      | 9%    | inside the allowance                          |
| 000a-app-shell default › mobile                              | 63     | 754       | 8%    | inside the allowance                          |
| 065-rejected-request-resubmission counter-offer › mobile     | 54     | 754       | 7%    | inside the allowance                          |
| 020-create-budget default › mobile                           | 38     | 754       | 5%    | inside the allowance                          |
| 120-approved-allocations default › mobile                    | 28     | 754       | 4%    | inside the allowance                          |
| 088-audit-log default › tablet                               | 52     | 1855      | 3%    | inside the allowance                          |
| 088-audit-log default › mobile                               | 19     | 754       | 3%    | inside the allowance                          |
| 059-approval-inbox default › mobile                          | 17     | 754       | 2%    | inside the allowance                          |
| 064-request-history pending › mobile                         | 17     | 754       | 2%    | inside the allowance                          |
| 060-request-details rejected › mobile                        | 16     | 754       | 2%    | inside the allowance                          |
| 055-my-requests default › mobile                             | 7      | 754       | 1%    | inside the allowance                          |
| 123-notifications-tasks default › mobile                     | 6      | 754       | 1%    | inside the allowance                          |
| 123-notifications-tasks tasks › mobile                       | 6      | 754       | 1%    | inside the allowance                          |

## Not measured (137)

These states did not reach a screenshot comparison, so they carry no reading.

- 115-employee-dashboard default › desktop
- 121-upload-receipt default › mobile
- 121-upload-receipt amount-check › desktop
- 121-upload-receipt amount-check › tablet
- 121-upload-receipt amount-check › mobile
- 066-rules-overview default › desktop
- 066-rules-overview default › tablet
- 066-rules-overview default › mobile
- 067-rules-list default › desktop
- 067-rules-list default › tablet
- 067-rules-list default › mobile
- 068-rule-detail conflicting-draft › desktop
- 068-rule-detail conflicting-draft › tablet
- 068-rule-detail conflicting-draft › mobile
- 069-rule-simulation default › desktop
- 069-rule-simulation default › tablet
- 069-rule-simulation default › mobile
- 069-rule-simulation blocked-outcome › desktop
- 069-rule-simulation blocked-outcome › tablet
- 069-rule-simulation blocked-outcome › mobile
- 070-approval-routing default › desktop
- 070-approval-routing default › tablet
- 070-approval-routing default › mobile
- 070a-approval-limits default › desktop
- 070a-approval-limits default › tablet
- 070a-approval-limits default › mobile
- 071-spending-limits default › desktop
- 071-spending-limits default › tablet
- 071-spending-limits default › mobile
- 071a-thresholds-templates default › desktop
- 071a-thresholds-templates default › tablet
- 071a-thresholds-templates default › mobile
- 072-category-policy default › desktop
- 072-category-policy default › tablet
- 072-category-policy default › mobile
- 072a-gifts-entertainment default › desktop
- 072a-gifts-entertainment default › tablet
- 072a-gifts-entertainment default › mobile
- 073-location-policy default › desktop
- 073-location-policy default › tablet
- 073-location-policy default › mobile
- 073a-vendor-policy default › desktop
- 073a-vendor-policy default › tablet
- 073a-vendor-policy default › mobile
- 074-over-budget-policy default › desktop
- 074-over-budget-policy default › tablet
- 074-over-budget-policy default › mobile
- 074a-post-spend-exceptions default › desktop
- 074a-post-spend-exceptions default › tablet
- 074a-post-spend-exceptions default › mobile
- 075-freeze-zero-policy default › desktop
- 075-freeze-zero-policy default › tablet
- 075-freeze-zero-policy default › mobile
- 076-sla-notifications default › desktop
- 076-sla-notifications default › tablet
- 076-sla-notifications default › mobile
- 077-rule-backtest default › desktop
- 077-rule-backtest default › tablet
- 077-rule-backtest default › mobile
- 078-rule-history default › desktop
- 078-rule-history default › tablet
- 078-rule-history default › mobile
- 043-events-dashboard default › desktop
- 043-events-dashboard default › tablet
- 043-events-dashboard default › mobile
- 045a-event-templates default › desktop
- 045a-event-templates default › tablet
- 045a-event-templates default › mobile
- 045a-event-templates my-templates › desktop
- 045a-event-templates my-templates › tablet
- 045a-event-templates my-templates › mobile
- 046b-checklist-tasks-agenda default › desktop
- 046b-checklist-tasks-agenda default › tablet
- 046b-checklist-tasks-agenda default › mobile
- 046b-checklist-tasks-agenda agenda › desktop
- 046b-checklist-tasks-agenda agenda › tablet
- 046b-checklist-tasks-agenda agenda › mobile
- 047a-invitations-rsvp default › desktop
- 047a-invitations-rsvp default › tablet
- 047a-invitations-rsvp default › mobile
- 047b-attendee-needs default › desktop
- 047b-attendee-needs default › tablet
- 047b-attendee-needs default › mobile
- 047e-attendance-per-head-recalculation default › desktop
- 047e-attendance-per-head-recalculation default › tablet
- 047e-attendance-per-head-recalculation default › mobile
- 051a-vendor-quotes default › desktop
- 051a-vendor-quotes default › tablet
- 051a-vendor-quotes default › mobile
- 054a-survey-photo-gallery default › desktop
- 054a-survey-photo-gallery default › tablet
- 054a-survey-photo-gallery default › mobile
- 054a-survey-photo-gallery gallery › desktop
- 054a-survey-photo-gallery gallery › tablet
- 054a-survey-photo-gallery gallery › mobile
- 054b-event-roi-scorecard default › desktop
- 054b-event-roi-scorecard default › tablet
- 054b-event-roi-scorecard default › mobile
- 059a-mobile-web-approvals default › desktop
- 059a-mobile-web-approvals default › tablet
- 059a-mobile-web-approvals default › mobile
- 080e-period-close-break-glass closed › mobile
- 080e-period-close-break-glass request-dialog › desktop
- 080e-period-close-break-glass request-dialog › tablet
- 080e-period-close-break-glass request-dialog › mobile
- 087c-rollover-policies default › desktop
- 087c-rollover-policies default › tablet
- 087c-rollover-policies default › mobile
- 087b-year-end default › desktop
- 087b-year-end default › tablet
- 087b-year-end default › mobile
- 087b-year-end-run draft › desktop
- 087b-year-end-run draft › tablet
- 087b-year-end-run draft › mobile
- 087-forecast-variance default › desktop
- 087-forecast-variance default › tablet
- 087-forecast-variance default › mobile
- 087-forecast-variance commentary-required-only › desktop
- 087-forecast-variance commentary-required-only › tablet
- 087-forecast-variance commentary-required-only › mobile
- 087-forecast-variance compare-snapshots › desktop
- 087-forecast-variance compare-snapshots › tablet
- 087-forecast-variance compare-snapshots › mobile
- 087-forecast-variance scoped-owner › desktop
- 087-forecast-variance scoped-owner › tablet
- 087-forecast-variance scoped-owner › mobile
- 087a-forecast-cycles list › desktop
- 087a-forecast-cycles list › tablet
- 087a-forecast-cycles list › mobile
- 087a-forecast-cycles monitor › desktop
- 087a-forecast-cycles monitor › tablet
- 087a-forecast-cycles monitor › mobile
- 087a-forecast-cycles closed › desktop
- 087a-forecast-cycles closed › tablet
- 087a-forecast-cycles closed › mobile
- 087a-forecast-cycles owner › desktop
- 087a-forecast-cycles owner › tablet
