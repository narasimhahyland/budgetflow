---
name: BudgetFlow Satori
colors:
  primary: '#5654ac'
  on-primary: '#ffffff'
  primary-container: '#e2dfff'
  on-primary-container: '#322f86'
  primary-loud: '#322f86'
  secondary: '#5d5c72'
  on-secondary: '#ffffff'
  secondary-container: '#e2e0f9'
  on-secondary-container: '#45455a'
  tertiary: '#006b61'
  on-tertiary: '#ffffff'
  tertiary-container: '#9df2e4'
  on-tertiary-container: '#005048'
  error: '#b02b36'
  on-error: '#ffffff'
  error-container: '#ffdad9'
  on-error-container: '#8c1d29'
  background: '#f4f3f7'
  on-background: '#1a1c1e'
  surface: '#f9f9fc'
  surface-dim: '#dad9dd'
  surface-bright: '#f9f9fc'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f4f3f7'
  surface-container: '#eeedf1'
  surface-container-high: '#e8e7eb'
  surface-container-highest: '#e2e2e6'
  surface-variant: '#e4e1ef'
  on-surface: '#1a1c1e'
  on-surface-variant: '#474551'
  inverse-surface: '#2f3033'
  inverse-on-surface: '#f1f0f4'
  inverse-primary: '#c4c1ff'
  outline: '#777683'
  outline-variant: '#c8c5d3'
  success: '#4d9c4c'
  success-container: '#eef6e8'
  on-success-container: '#3d7231'
  warning: '#967c39'
  warning-container: '#fbf3db'
  on-warning-container: '#7e651b'
  info: '#5384f1'
  info-container: '#e5f3fc'
  on-info-container: '#3060c6'
  important: '#c74f54'
  important-container: '#faeae9'
  on-important-container: '#ac4848'
typography:
  headline-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 32px
    fontWeight: '600'
    lineHeight: 40px
  headline-md:
    fontFamily: Plus Jakarta Sans
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 36px
  headline-sm:
    fontFamily: Plus Jakarta Sans
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 32px
  title-lg:
    fontFamily: Plus Jakarta Sans
    fontSize: 22px
    fontWeight: '600'
    lineHeight: 28px
  title-md:
    fontFamily: Noto Sans
    fontSize: 16px
    fontWeight: '500'
    lineHeight: 24px
  title-sm:
    fontFamily: Noto Sans
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
  body-lg:
    fontFamily: Noto Sans
    fontSize: 16px
    fontWeight: '400'
    lineHeight: 24px
  body-md:
    fontFamily: Noto Sans
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 20px
  body-sm:
    fontFamily: Noto Sans
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 16px
  label-lg:
    fontFamily: Noto Sans
    fontSize: 14px
    fontWeight: '500'
    lineHeight: 20px
  label-md:
    fontFamily: Noto Sans
    fontSize: 12px
    fontWeight: '500'
    lineHeight: 16px
  label-sm:
    fontFamily: Noto Sans
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 16px
rounded:
  xs: 4px
  sm: 8px
  md: 12px
  lg: 16px
  xl: 28px
  full: 9999px
spacing:
  space-xs: 4px
  space-sm: 8px
  space-md: 16px
  space-lg: 24px
  space-xl: 32px
  gutter: 16px
  margin: 24px
---

## Brand and style

BudgetFlow Enterprise is a corporate budget delegation and control platform built on the Satori design system (Angular Material 3 underneath). The look is calm, precise and trustworthy: violet primary, neutral cool-grey surfaces, dense but readable data, and explicit status colors. Never decorative. English copy only.

## Colors

- Primary violet #5654ac for primary buttons, links, selected states and focus. Primary-loud #322f86 for emphasis text and the active navigation item.
- Page background is surface-container-low #f4f3f7. Tables, toolbars, cards and panels sit on surface-container-lowest #ffffff with a 1px outline-variant #c8c5d3 border or Material elevation level 1.
- Text: on-surface #1a1c1e, secondary text on-surface-variant #474551, borders outline #777683 and outline-variant #c8c5d3.
- Status tones, each with a container background and darker text: success (approved, active, matched), warning (soft warning, pending, near threshold), info (frozen, informational), important (set to zero, rejected), error #b02b36 (hard block, validation error, failed). Neutral grey for draft, closed, expired, cancelled.
- Tertiary teal #006b61 is used only for charts and secondary accents.

## Theme

Light theme only. Dark theme is deferred.

## Typography

Headlines use Plus Jakarta Sans (stand-in for Figtree). Body, labels, tables and forms use Noto Sans. All money, numbers and percentages use tabular numerals, right aligned in tables, always with the ISO currency code (USD 30,000.00, INR 8,30,000, EUR 25,000.00).

## Layout and spacing

Desktop first, 1440px wide. Left platform navigation sidebar (240px expanded, 72px collapsed) filled with primary violet and white text and icons. White app header (64px) with page title, breadcrumbs, global search, tenant and organization switcher, notifications and user menu. Content area on surface-container-low with 24px margins and 16px gutters, 12-column grid. 4px base unit. Tablet collapses the sidebar to icons; mobile uses a top app bar with a menu drawer and stacked cards.

## Elevation and shape

Material 3 elevation: level 0 for page, level 1 for cards and tables, level 2 for menus and drawers, level 3 for dialogs. Radii: 4px inputs, menus and table containers; 8px chips, status tags and small cards; 12px cards; 16px drawers and large cards; 28px dialogs; buttons are fully rounded pills.

## Components

- Platform navigation sidebar: violet background, white Material Icons (filled style) with labels, grouped sections, active item with a lighter violet pill highlight, tenant switcher at the top, user at the bottom.
- App header: white, page title, breadcrumbs, search field, icon buttons for notifications and help, avatar menu.
- Header bar: page title with primary action button on the right and secondary outlined buttons.
- Buttons: filled primary violet pill; outlined pill with outline border; text button; tonal icon buttons. Destructive actions use error color. Primary financial actions are filled "important" style buttons.
- Dense data tables: white container, 48px rows, 52px header, column headers in label-lg on-surface-variant, row hover tint, selected row primary-container tint, row state stripe on the left (warning, error, info), right-aligned tabular numbers, sort arrows, paginator at the bottom, selection bar for bulk actions.
- Status tags: small rounded tags with icon and text on status container colors. Never color alone.
- Banners: full-width inline banners with icon, title, text and action, in info, warning, error, important and success tones.
- KPI cards: white, 12px radius, label, large tabular value with currency code, delta chip, thin progress bar.
- Empty, error and forbidden states: centered illustration-free icon, title, one sentence, one primary action.
- Dialogs: 28px radius, title, body, impact summary, reason field, primary and secondary actions right-aligned.
- Drawers and side sheets: right side, 480px, header with close icon, scrollable body, sticky footer actions.
- Forms: outlined Material form fields with floating labels, helper text, error text in error color, currency prefix inside the field.
- Toasts: dark inverse-surface snackbar bottom center with an action.
- Charts: Satori data-visualization palette (violet, teal, blue, amber, rose), thin gridlines, always with a table alternative.
- Icons: Material Icons (filled, classic style). No Material Symbols.

## Budget safety visuals

Allocated vs available use distinct bar segments and labels. Held, pre-encumbered, encumbered, actual and accrued each have their own swatch. Forecast is dashed or hatched. Soft warning uses the warning container and the user can proceed; hard block uses the error container with the action disabled and the reason shown. Frozen shows a lock icon in info tone; set to zero uses the important tone. Pending vs approved use warning vs success tags. Budget currency and reporting currency are shown side by side and the FX effect is a separate line, never folded into consumption.
