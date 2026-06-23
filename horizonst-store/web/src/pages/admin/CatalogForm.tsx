import { FormEvent } from 'react';
import type { Product, SaasPlan } from '../../lib/types';

export type ProductFormValue = Partial<Product>;
export type SaasPlanFormValue = Partial<SaasPlan>;

type Props =
  | { kind: 'product'; value: ProductFormValue; onSubmit: (value: ProductFormValue) => void }
  | { kind: 'saas-plan'; value: SaasPlanFormValue; onSubmit: (value: SaasPlanFormValue) => void };

const stringValue = (formData: FormData, key: string) => String(formData.get(key) ?? '').trim();
const numberValue = (formData: FormData, key: string) => {
  const value = stringValue(formData, key);
  return value === '' ? undefined : Number(value);
};

export default function CatalogForm(props: Props) {
  const isPlan = props.kind === 'saas-plan';

  const onSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    props.onSubmit(isPlan ? readPlan(formData) : readProduct(formData));
  };

  return (
    <form className="admin-form" onSubmit={onSubmit}>
      {isPlan ? <PlanFields value={props.value} /> : <ProductFields value={props.value} />}
      <input name="name" defaultValue={props.value.name ?? ''} placeholder="Nombre" />
      <textarea name="description" defaultValue={props.value.description ?? ''} placeholder="Descripción" />
      <input name="tax_rate" type="number" step="0.01" defaultValue={props.value.tax_rate ?? 21} placeholder="IVA" />
      <label><input name="is_active" type="checkbox" defaultChecked={props.value.is_active ?? true} /> Activo</label>
      <button>Guardar</button>
    </form>
  );
}

function ProductFields({ value }: { value: ProductFormValue }) {
  return <>
    <input name="sku" defaultValue={value.sku ?? ''} placeholder="SKU" />
    <select name="category" defaultValue={value.category ?? 'hardware'}>
      <option value="hardware">hardware</option>
      <option value="accessory">accessory</option>
    </select>
    <input name="price_cents" type="number" defaultValue={value.price_cents ?? 0} placeholder="Precio céntimos" />
  </>;
}

function PlanFields({ value }: { value: SaasPlanFormValue }) {
  return <>
    <input name="code" defaultValue={value.code ?? ''} placeholder="Código" />
    <input name="annual_price_cents" type="number" defaultValue={value.annual_price_cents ?? ''} placeholder="Precio anual céntimos" />
    <input name="max_tags" type="number" defaultValue={value.max_tags ?? ''} placeholder="Max tags" />
    <input name="max_gateways" type="number" defaultValue={value.max_gateways ?? ''} placeholder="Max gateways" />
    <label><input name="is_enterprise" type="checkbox" defaultChecked={value.is_enterprise ?? false} /> Enterprise sin precio automático</label>
  </>;
}

function readProduct(formData: FormData): ProductFormValue {
  return {
    sku: stringValue(formData, 'sku'),
    name: stringValue(formData, 'name'),
    description: stringValue(formData, 'description') || null,
    category: stringValue(formData, 'category'),
    price_cents: numberValue(formData, 'price_cents'),
    tax_rate: numberValue(formData, 'tax_rate'),
    is_active: formData.get('is_active') === 'on'
  };
}

function readPlan(formData: FormData): SaasPlanFormValue {
  const isEnterprise = formData.get('is_enterprise') === 'on';
  return {
    code: stringValue(formData, 'code'),
    name: stringValue(formData, 'name'),
    description: stringValue(formData, 'description') || null,
    annual_price_cents: isEnterprise ? null : numberValue(formData, 'annual_price_cents'),
    tax_rate: numberValue(formData, 'tax_rate'),
    max_tags: numberValue(formData, 'max_tags') ?? null,
    max_gateways: numberValue(formData, 'max_gateways') ?? null,
    is_enterprise: isEnterprise,
    is_active: formData.get('is_active') === 'on'
  };
}
