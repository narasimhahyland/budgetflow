# Leadership demo: what to say at each step

Speaker notes for the trimmed runbook (`docs/demo/leadership-demo-runbook.md`, PR #139). Step numbers
match the runbook. Say it in your own words; the figures quoted are what a freshly reset stack shows.

## Opening (1 minute)

"Most companies run budgets in spreadsheets and email. Money gets promised twice, approvals depend on who
you know, and nobody can say quickly what is left. BudgetFlow is one place where a budget is approved,
handed down the organization, spent within limits, and tied to the books.

In the next half hour you'll see a new year funded from scratch, handed down to the regions, spent and
approved inside authority limits, and the controls finance uses when it needs to stop money. Every number
comes from the ledger, and every change is recorded. Everyone you'll see is a fictional person playing a
real role."

---

## Act 1. Fund FY2027 and delegate it down

**1.1 Import the plan (Priya)**
"I'm in the CFO's office. Next year starts as a plan. I paste it in from a spreadsheet, and before anything
is saved BudgetFlow checks every row: the program code, the amount and the legal entity. Bad rows are
caught here, not after money has moved."

**1.2 Approve it**
"I approve it, and it becomes the controlling plan for FY2027. The year's spending authority now comes
from this approved version. If finance later wants to add money with a revision, that needs a second
finance admin and the CEO, and never the person who drafted it."

**1.3 Create the top budget and show the tie-out**
"Now I create the top-level budget for the year and link it to the plan. Look at the tie-out: the plan
says 120,000 dollars, the budget holds 120,000, difference zero. Leadership can always see that what's
out there matches what was approved."

**1.4 Hand it to the regions**
"I give India 30,000, the US 40,000 and Europe 30,000, each with an owner, a legal entity and a cost
center. That leaves 20,000 unallocated as headroom. Each step is a balanced posting: what the parent
gives, the child receives."

**1.5 Try to over-allocate**
"Here's the first control. I try to give India another 30,000, but only 20,000 is left. BudgetFlow
blocks it right there: 'Nothing posts until it fits.' This isn't a warning someone can click past. You
cannot hand out money you don't have."

**1.6 Ananya re-delegates**
"Now I'm Ananya, who runs India. She passes 12,000 down to her Bengaluru events manager. She can do this
herself, but only within what she was given: 30,000 authorized, 12,000 handed down, 18,000 left."

**1.7 Jordan can't see India**
"I'm Jordan, who runs the US. If I paste India's budget link, I get 'We could not find this budget.' It
doesn't even confirm the budget exists. Directors see their own budgets and nothing else."

_Transition:_ "That's how money flows down. Now, who is allowed to spend it?"

---

## Act 2. Approvals within delegation-of-authority limits

**2.1 The delegation-of-authority matrix (Priya)**
"Owning a budget doesn't mean you can approve spend from it. Approval authority comes from this matrix:
who can approve what kind of spend, in which legal entity, up to what amount. It's versioned and was
approved by the CEO. I can check any limit here, and exactly at the limit passes."

**2.2 Rahul approves a request**
"Rahul is the Bengaluru approver. A team lunch for 216 dollars is waiting for him. Before he decides, he
sees what it does to the budget: what's available now and what's left after. He sees why it came to him:
his authority goes up to 1,000 dollars. He confirms he has no conflict of interest and approves. He could
also approve part of it, reject it, send it back, or escalate it."

**2.3 Delegation**
"This tab shows work delegated to him. Ananya has handed Rahul her approvals for a while, but only up to
her own limit and only for a set period. Delegation can never be used to get around a limit."

**2.4 The requester sees the history (Kavya)**
"Kavya raised the request. Her history shows who approved it, when, and that it was within their
authority. And she could never have approved it herself; the system won't allow it."

_Transition:_ "Limits decide who approves. Rules decide what needs approval in the first place."

---

## Act 3. Rules engine

**3.1 Rules and policies (Priya)**
"Company policy lives here as rules, not in people's heads. You can see what's active, a draft that
can't be published because it conflicts with an active rule, and how rules decided requests week by
week."

**3.2 Test a request**
"Before changing anything, finance can test a request. A 300-dollar team event in Bengaluru, with alcohol.
The answer is 'needs approval', because of the rule that alcohol is allowed only at approved events, with
the parent budget owner signing off. It also lists every other rule that matched, and why the strictest
one wins. Nothing was created. This is the same reasoning a real request gets."

_Transition:_ "Some spending crosses budgets: an event several locations pay for."

---

## Act 4. Event co-funding through an Inter-Director Budget Contribution Request

**4.1 The event and its funding (Kavya)**
"Kavya is running Diwali for Bengaluru and Hyderabad: 4,800 dollars estimated. Her own budget covers
3,000. The rest has to come from other directors. The co-funding board shows each contribution: one
approved in part, one still waiting, and one from Europe already set aside."

**4.2 Ananya decides on a contribution**
"This is an Inter-Director Budget Contribution Request. Nobody can take money from another director's
budget; they have to ask. Ananya is asked for 720 dollars. She decides to give 500, with a reason. The
money is earmarked on her own budget for this event, and the event's funding gap drops to 160 dollars.
Her decision is audited, and Kavya is notified."

**4.3 Intercompany recharge (Daniel)**
"Europe's contribution crosses legal entities, from the German company to the Indian one. So BudgetFlow
creates the intercompany recharge automatically, here with a 5 percent markup per policy. Finance doesn't
have to remember to do it."

_Transition:_ "So far everything has been going ahead. What if leadership needs to stop money?"

---

## Act 5. Freeze, reduce, set to zero

**5.1 Reduce (Priya)**
"I cut the US budget by 5,000. I have to say where the money goes, back to the parent here, and give a
reason. BudgetFlow won't let me cut below what's already committed or spent."

**5.2 Set to zero, with the impact preview**
"The strongest control is set to zero. Before I confirm, I see exactly what it would do to Bengaluru
Events: 12,000 authorized, 1,686 already spent, 7,232 committed. So 8,918 is protected, and 3,082 would
be cut. Commitments already made still get paid. To confirm, I'd need a reason code, a reason, and to type
the budget code. I'll cancel; I just wanted you to see the preview."

**5.3 Freeze**
"A freeze is the pause button. Europe is frozen with a reason. New requests and allocations are refused
with that reason, and nothing already approved is undone."

**5.4 What it looks like in the list**
"In the budget list, frozen and set-to-zero budgets look different from each other and from active ones.
Their history is still all there."

_Transition:_ "Now the money that actually leaves the company."

---

## Act 6. Actuals and matching

**6.1 The ERP import (Daniel)**
"Spend comes in from the ERP. This November file has 9 lines: 3 matched automatically, 3 partly, and 3
need a person. Indian rupee lines convert at the rate locked when the plan was approved. Exchange-rate
moves never eat into anyone's budget."

**6.2 An event that can't close**
"The New York offsite is finished, but it can't be closed. One 640-dollar invoice hasn't been matched yet.
An event can't close with spend nobody has accounted for."

**6.3 AI suggests the match, Daniel decides**
"The AI looks at that invoice and ranks where it probably belongs, with its reasons. Daniel picks New York
Events and confirms. That runs the normal matching step under his permission, and his decision is recorded.
And the offsite is now ready to close."
_If the FY2027 budget is ranked first:_ "Notice the AI's first guess is next year's budget. If he accepted
it, the system would refuse, because the invoice is from this year. The AI suggests; the rules and the
person decide."

_Transition:_ "Everything you've seen so far left a trail. Let's look at it."

---

## Act 7. Ledger and hash-chained audit trail

**7.1 The ledger (Priya)**
"Behind every number is a ledger. Here's the US budget: the money it received and the 5,000 cut, as
journal lines. Nobody edits a line. Mistakes are corrected by a reversing entry, so the history stays
intact."

**7.2 The audit log (Grace)**
"Grace is our auditor. Every action today is here: who did it, what changed, and why. Each entry is
chained to the previous one with a cryptographic hash. I click Verify chain, and it confirms nothing has
been altered or removed."

**7.3 The ledger check**
"Every night BudgetFlow rebuilds every balance from the ledger lines and compares it with the balances on
screen. Grace can also run the check now. 'Clean': the balances match the rebuild for every budget, and
the audit chain is verified. If they ever differ, it raises a flag. It never quietly fixes itself."

**7.4 System health**
"Operations sees the same check here as a job with its last result."

_Transition:_ "So the numbers can be trusted. Here's how leadership sees them."

---

## Act 8. Reporting

**8.1 Home (Morgan)**
"This is the CEO's start page: where the year stands, how much is authorized, committed, spent and still
available, and which budgets need attention first."

**8.2 Utilization**
"Utilization breaks it down by budget: pending, committed, spent and available. Click any figure and you
see the ledger lines behind it. No number on a report is typed in by hand."

**8.3 Board pack**
"The board pack is built from the last closed month, with the pages you choose, and it generates as PDF
and Excel. Same numbers as everywhere else."

_Transition:_ "Last, the assistant."

---

## Act 9. AI that suggests, people decide

**9.1 Ask a question (Rahul)**
"Rahul asks how much is left in Bengaluru Events. The answer is labeled as written by the model. The
figures in the table are read straight from the ledger, not written by the model, and it shows which
records it used."

**9.2 Ask it to act**
"Now he asks it to move 5,000 dollars. It refuses: the AI doesn't act. It points him to the screen where a
person does that, with the normal approvals."

**9.3 Ask outside his scope**
"And if he asks about Berlin, a budget he can't see, it says it can only answer about what he can see.
The AI sees exactly what the person asking sees, and no more."

**9.4 The AI query log (Grace)**
"Every AI call is logged: who asked, which feature, which records, and the outcome, answered or refused.
The log doesn't store what people typed."

**9.5 AI settings (Taylor)**
"Each AI feature has its own on and off switch for the company, and you can see exactly which fields each
one sends to the model. Nothing here can let the AI approve, move money or change a rule."

---

## Close (1 minute)

"So: a year funded from an approved plan and tied out to the dollar. Money handed down, never more than
was given. Approvals that follow authority, not ownership. Policy that explains itself. Co-funding that is
asked for, decided and audited. Controls that stop new spending without breaking what was promised. Spend
matched to the books. And an assistant that helps but never decides.

Happy to go back to any part, or take questions."

## If asked

- **"Is the AI answer always the same?"** In this demo it runs offline with fixed wording. With a live
  model the wording varies, but the figures always come from the ledger.
- **"Is everything built?"** The core you saw is. A few planned items are still open and listed in the
  gap-closure plan. Don't promise them as done.
- **"Accessibility, dark mode?"** Both are deferred.
