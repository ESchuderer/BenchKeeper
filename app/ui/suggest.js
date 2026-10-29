// What a suggestion compares with: a switch is on or off by its own rule, "leave unset" is no value.
// A zeroIsSet switch counts any present value as set, 0 and false included; another switch is on for 1 or true only.
const norm = (row, v) => (row.type === 'switch' ? v != null && (row.zeroIsSet ? String(v) !== '' : v === true || v === 1 || /^(1|true)$/i.test(String(v))) : v ?? null);
export const matches = (row, v) => JSON.stringify(norm(row, v)) === JSON.stringify(norm(row, row.suggest.value));
export const ownOf = (row, layer) => row.sets?.find((x) => x.layer === layer)?.value;
export const differs = (row, layer) => !!row.suggest && !matches(row, ownOf(row, layer));

// A layer listed before this one in precedence sets the key, so a value written here would not take effect.
const overridden = (row, layer, precedence) => (row.sets ?? []).some((x) => precedence.indexOf(x.layer) < precedence.indexOf(layer));

// The values a note's fix sets: the suggestions of its editable settings that differ and that the layer decides, and none when
// the note prescribes no fix.
export const fixOf = (note, rows, layer, precedence) => (note.fix ? Object.fromEntries(rows.filter((r) => r.editable !== false && differs(r, layer) && !overridden(r, layer, precedence)).map((r) => [r.key, r.suggest.value])) : {});
