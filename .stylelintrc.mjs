import satoriAdoption from '@hylandsoftware/satori-lint/stylelint/satori-adoption.stylelintrc';

// Satori adoption rules plus project bans: no raw colors and no font-family declarations in app styles
// (style with --mat-sys-* / --sat-sys-* tokens; Satori fonts are already loaded).
export default {
  ...satoriAdoption,
  rules: {
    ...satoriAdoption.rules,
    'color-no-hex': true,
    'color-named': 'never',
    'function-disallowed-list': ['rgb', 'rgba', 'hsl', 'hsla'],
    'declaration-property-value-disallowed-list': { 'font-family': ['/.*/'] },
  },
};
