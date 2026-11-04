# Design preview (Stitch)

Status: proposed designs, light theme only, awaiting user review. Record decisions in [review-log.md](review-log.md).

## Projects
| Project | Use | Link |
| --- | --- | --- |
| BudgetFlow Satori - Design preview (`4948604653652709875`) | Review copy: only the Satori start screens, titled "NNN Name", one screen per design | https://stitch.withgoogle.com/preview/4948604653652709875 |
| BudgetFlow Enterprise UI (`1643421514270618068`) | Source of every exported image in `design/stitch/` and every state; also holds the 24 original screens (untouched) | https://stitch.withgoogle.com/preview/1643421514270618068 |

The preview project is **private**; the Stitch MCP cannot change visibility or share a project, so the owner must share it in the Stitch web app before others can open these links. The main project is public.

## Screens in flow order
Core journey first (shell, executive dashboard, budget hierarchy, allocation, create event, approval inbox, audit log), then the two screens outside it. "Preview copy" opens the screen in the preview project; "Exported default" and the state links open the exact screens the repo images were exported from.

| # | Screen | Preview copy | Exported default | State screens (main project) |
| --- | --- | --- | --- | --- |
| 1 | 000 Design system | (regeneration timed out; use the exported default) | [default](https://stitch.withgoogle.com/preview/1643421514270618068?node-id=5d02c6a4235a47d7968986b9629e76b9) | - |
| 2 | 000a Application shell | [000a](https://stitch.withgoogle.com/preview/4948604653652709875?node-id=aec8768aea754d11ab5575b46b932e6a) | [default](https://stitch.withgoogle.com/preview/1643421514270618068?node-id=fd62ca975f5b497e960db74a6f608b2c) | [switcher-open](https://stitch.withgoogle.com/preview/1643421514270618068?node-id=7e6e2b1ce7ec4f3e9e120bb79b5b31e4), [notifications-open](https://stitch.withgoogle.com/preview/1643421514270618068?node-id=662a5cd63a644fcaa4c9882f2913de9e), [search-open](https://stitch.withgoogle.com/preview/1643421514270618068?node-id=d177aebf5cf74c9697a652d447a2b61c), [employee-forbidden](https://stitch.withgoogle.com/preview/1643421514270618068?node-id=9000745aaecd460a82511a8d60739e71), [nav-drawer-open (mobile)](https://stitch.withgoogle.com/preview/1643421514270618068?node-id=7ece71aa70904a62a3ea5d9d92c8a3a2) |
| 3 | 011 Executive dashboard | [011](https://stitch.withgoogle.com/preview/4948604653652709875?node-id=609c9843515a4ab6b9b727936980c79e) | [default](https://stitch.withgoogle.com/preview/1643421514270618068?node-id=8e3e69d7a1894ea68503b203dd1141e0) | [loading](https://stitch.withgoogle.com/preview/1643421514270618068?node-id=bce1d3f39e9c4ab4ab39513becea969f), [empty](https://stitch.withgoogle.com/preview/1643421514270618068?node-id=83786f7e8b3c45d1899b5d33d0389311), [error](https://stitch.withgoogle.com/preview/1643421514270618068?node-id=413ee59e2b1644d8bc7af92ecd5de3d1) |
| 4 | 023 Budget hierarchy | [023](https://stitch.withgoogle.com/preview/4948604653652709875?node-id=7b76bc042a4e447e9216145c70273f08) | [default](https://stitch.withgoogle.com/preview/1643421514270618068?node-id=78e9e80886724ba799cba008d430c342) | [set-to-zero-dialog](https://stitch.withgoogle.com/preview/1643421514270618068?node-id=2ebc666182144346a80d9339d3f15954) |
| 5 | 022 Budget allocation workspace | [022](https://stitch.withgoogle.com/preview/4948604653652709875?node-id=f4c64e2f9759456bbbac8c88238a2a40) | [default](https://stitch.withgoogle.com/preview/1643421514270618068?node-id=ccdbc282cac64caeba9a188fb6fcc676) | [warning-block](https://stitch.withgoogle.com/preview/1643421514270618068?node-id=0fd10f99e1ac45879ac85fb3a887e3ba) |
| 6 | 045 Create event budget | [045](https://stitch.withgoogle.com/preview/4948604653652709875?node-id=212fec966dda41d7aa3856d8baa2bf59) | [default](https://stitch.withgoogle.com/preview/1643421514270618068?node-id=bd913fe9a61c407bb2da75de0b33b6fa) | [validation](https://stitch.withgoogle.com/preview/1643421514270618068?node-id=7424a64b08144c8395b312a6a0952352) |
| 7 | 059 Approval inbox | [059](https://stitch.withgoogle.com/preview/4948604653652709875?node-id=c40f9c3629fa4a31ba9604ff8cd69a87) | [default](https://stitch.withgoogle.com/preview/1643421514270618068?node-id=989446b543a047778ce424b9107f5fc7) | [delegated-escalated](https://stitch.withgoogle.com/preview/1643421514270618068?node-id=5a48d078e28f467294bc37c69602646f), [empty](https://stitch.withgoogle.com/preview/1643421514270618068?node-id=b0273e4f48a04f7794cc604b3e1e7454) |
| 8 | 088 Audit log | [088](https://stitch.withgoogle.com/preview/4948604653652709875?node-id=39dda5cc01e84c1285ef9abe3ef75dfc) | [default](https://stitch.withgoogle.com/preview/1643421514270618068?node-id=eb69eed067bf4f34a1dcba6b01ccd962) | [chain-broken](https://stitch.withgoogle.com/preview/1643421514270618068?node-id=c4cd69178174441982a33037c393dc27) |
| 9 | 069 Rule builder | [069](https://stitch.withgoogle.com/preview/4948604653652709875?node-id=7cee12c66ef441fc8944ea6df7f22a13) | [default](https://stitch.withgoogle.com/preview/1643421514270618068?node-id=bbb72843f67d43a087e8308adcf569d7) | [conflict-simulation](https://stitch.withgoogle.com/preview/1643421514270618068?node-id=1ca57659dc784b79a69e2df2134f8cf5) |
| 10 | 115 Employee dashboard | [115](https://stitch.withgoogle.com/preview/4948604653652709875?node-id=0f22185c21f145f1afa977e36d0f4ad3) | [default](https://stitch.withgoogle.com/preview/1643421514270618068?node-id=b42ff3f7211c4f85bd165d75d9aa1e8f) | [blocked](https://stitch.withgoogle.com/preview/1643421514270618068?node-id=5b64f85e79c247009adbdf8be059cf88) |

## How to review
1. Open the preview project and step through the screens in the order above; each shows the default state of one screen.
2. For the exact design that implementation builds against, open "Exported default" and the state links (these match the PNGs in `design/stitch/<NNN-slug>/` and the specs in `docs/ux/screens/`).
3. Note decisions per screen (approve, or the changes needed) and record them in `review-log.md`.

## What Stitch could and could not do (MCP)
- Could: create the dedicated preview project, attach the BudgetFlow Satori design system (`assets/9318800711745724949`, same tokens), generate screens there with numbered titles, and give each screen a preview URL by node id.
- Could not copy screens between projects, so the preview copies are regenerations from the same briefs: layout and tokens match, but nav labels, owners and some sample values drift. The exported designs (main project) are the reference.
- Could not rename screens, so main-project screens keep Stitch's automatic titles; use this table for numbering.
- Could not create prototype links or interactions: the MCP has no hotspot, link or prototype tool. Previews are static screens, not a clickable prototype; move between them with the links above.
- Could not change project visibility or sharing, and `list_screens` returns nothing for the new project type.
