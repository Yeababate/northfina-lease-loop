// The category sub-filters (#72), shown inside the sidebar form for each ticked category.
// Part of the same GET form, so they travel in the URL like every other filter.
import {
  ebikeMotorSchema,
  farmMachineTypeSchema,
  laptopGpuSchema,
  type AssetCategory,
} from '@/data/schemas';
import {
  attributeParams as p,
  type AttributeOptions,
  type AttributeQuery,
} from '@/domain/catalogue-attributes';
import type { Translate } from '@/i18n/get-t';
import { CheckboxGroup, fieldClass } from './catalogue-filter-fields';

type Props = {
  query: AttributeQuery;
  categories: readonly AssetCategory[];
  options: AttributeOptions;
  t: Translate;
};

export function CatalogueAttributeFilters({ query, categories, options, t }: Props) {
  return (
    <>
      {categories.includes('e_bike') ? (
        <Group title={t('attr.ebikeTitle')}>
          <CheckboxGroup
            small
            legend={t('attr.motor')}
            name={p.ebikeMotor}
            options={ebikeMotorSchema.options.map((m) => ({
              value: m,
              label: t(`attr.motor.${m}`),
            }))}
            checked={query.ebike.motors}
          />
          <NumberField
            name={p.ebikePowerMin}
            label={t('attr.powerMin')}
            value={query.ebike.minWatts}
          />
          <NumberField
            name={p.ebikeBatteryMin}
            label={t('attr.batteryMin')}
            value={query.ebike.minBatteryWh}
          />
          <NumberField
            name={p.ebikeRangeMin}
            label={t('attr.rangeMin')}
            value={query.ebike.minRangeKm}
          />
          <CheckboxGroup
            small
            legend={t('attr.wheel')}
            name={p.ebikeWheel}
            options={options.wheels.map((inches) => ({
              value: String(inches),
              label: t('attr.wheelInches', { inches }),
            }))}
            checked={query.ebike.wheels.map(String)}
          />
        </Group>
      ) : null}

      {categories.includes('laptop') ? (
        <Group title={t('attr.laptopTitle')}>
          <CheckboxGroup
            small
            legend={t('attr.gpu')}
            name={p.laptopGpu}
            options={laptopGpuSchema.options.map((g) => ({ value: g, label: t(`attr.gpu.${g}`) }))}
            checked={query.laptop.gpus}
          />
          <CheckboxGroup
            small
            legend={t('attr.gpuModel')}
            name={p.laptopGpuModel}
            options={options.gpuModels.map((model) => ({ value: model, label: model }))}
            checked={query.laptop.gpuModels}
          />
        </Group>
      ) : null}

      {categories.includes('farm_machine') ? (
        <Group title={t('attr.farmTitle')}>
          <CheckboxGroup
            small
            legend={t('attr.farmType')}
            name={p.farmType}
            options={farmMachineTypeSchema.options.map((type) => ({
              value: type,
              label: t(`attr.farmType.${type}`),
            }))}
            checked={query.farm.types}
          />
          <NumberField
            name={p.farmPowerMin}
            label={t('attr.farmPowerMin')}
            value={query.farm.minPowerKw}
          />
          <NumberField
            name={p.farmWidthMin}
            label={t('attr.farmWidthMin')}
            value={query.farm.minWidthM}
            step="0.5"
          />
          <NumberField
            name={p.farmHoursMax}
            label={t('attr.farmHoursMax')}
            value={query.farm.maxEngineHours}
          />
        </Group>
      ) : null}
    </>
  );
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-3 rounded-xl border border-stone-300 p-3 dark:border-stone-700">
      <legend className="px-1 font-semibold">{title}</legend>
      {children}
    </fieldset>
  );
}

function NumberField(props: { name: string; label: string; value: number | null; step?: string }) {
  const id = `filter-${props.name}`;
  return (
    <div>
      <label htmlFor={id} className="text-sm">
        {props.label}
      </label>
      <input
        id={id}
        name={props.name}
        type="number"
        min={0}
        step={props.step ?? '1'}
        inputMode={props.step ? 'decimal' : 'numeric'}
        defaultValue={props.value ?? ''}
        className={`${fieldClass} mt-1`}
      />
    </div>
  );
}
