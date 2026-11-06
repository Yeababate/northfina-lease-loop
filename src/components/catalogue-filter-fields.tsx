// Small form fields shared by the catalogue sidebar and its category sub-filters.

export const fieldClass =
  'w-full rounded-lg border border-stone-400 bg-white px-3 py-2 text-stone-900 dark:border-stone-600 dark:bg-stone-900 dark:text-stone-100';

export function CheckboxGroup(props: {
  legend: string;
  name: string;
  options: { value: string; label: string }[];
  checked: readonly string[];
  /** A smaller legend, for groups nested inside another fieldset. */
  small?: boolean;
}) {
  return (
    <fieldset>
      <legend className={props.small ? 'text-sm' : 'font-semibold'}>{props.legend}</legend>
      <ul className={`${props.small ? 'mt-1' : 'mt-2'} space-y-1.5`}>
        {props.options.map((option) => (
          <li key={option.value}>
            <label className="flex items-center gap-3">
              <input
                type="checkbox"
                name={props.name}
                value={option.value}
                defaultChecked={props.checked.includes(option.value)}
                className="size-4 accent-blue-600"
              />
              {option.label}
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}

/** A group of radio buttons; the option with value '' is "no filter". */
export function RadioGroup(props: {
  legend: string;
  name: string;
  options: { value: string; label: string }[];
  checked: string;
}) {
  return (
    <fieldset>
      <legend className="font-semibold">{props.legend}</legend>
      <ul className="mt-2 space-y-1.5">
        {props.options.map((option) => (
          <li key={option.value}>
            <label className="flex items-center gap-3">
              <input
                type="radio"
                name={props.name}
                value={option.value}
                defaultChecked={props.checked === option.value}
                className="size-4 accent-blue-600"
              />
              {option.label}
            </label>
          </li>
        ))}
      </ul>
    </fieldset>
  );
}
