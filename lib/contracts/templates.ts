/** Contract template registry. MVP ships `standard`; adding a type is a row +
 *  a branch in ContractDocument. The `template_key` column + selector already
 *  carry the choice end-to-end. */
export const CONTRACT_TEMPLATES = [
  { key: "standard", label: "Standard Website Contract" },
] as const;

export type ContractTemplateKey = (typeof CONTRACT_TEMPLATES)[number]["key"];

export function isContractTemplateKey(v: string): boolean {
  return CONTRACT_TEMPLATES.some((t) => t.key === v);
}
